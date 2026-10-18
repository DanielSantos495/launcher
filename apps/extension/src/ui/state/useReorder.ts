import type { Account, Identity, Op, Section } from '@account-launcher/core'
import type { UiError, UiResponse, UiResults } from '@account-launcher/protocol'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { Translator } from '../../i18n/i18n'
import { moveIds, type Move } from '../lib/ordering'

// Qué se está arrastrando: una cuenta o una identidad (su sección).
type Dragging = { readonly kind: 'account' | 'identity'; readonly id: string }

export interface DragState {
  readonly dragging: Dragging | undefined
  // Elemento sobre el que está el puntero (para pintar el hueco), del mismo tipo que el arrastrado.
  readonly overId: string | undefined
}

export interface ReorderActions {
  readonly moveAccount: (account: Account, delta: -1 | 1) => void
  readonly moveIdentity: (identity: Identity, delta: -1 | 1) => void
  readonly dragStart: (kind: Dragging['kind'], id: string, event: DragEvent) => void
  readonly dragOver: (kind: Dragging['kind'], id: string, event: DragEvent) => void
  readonly drop: (kind: Dragging['kind'], id: string, event: DragEvent) => void
  readonly dragEnd: () => void
}

interface ReorderParams {
  readonly sections: readonly Section[]
  readonly view: 'identity' | 'group'
  readonly identities: readonly Identity[]
  readonly ownIdentityId: string | undefined
  readonly mutate: (ops: Op[]) => Promise<UiResponse<UiResults['data.mutate']>>
  readonly onError: (error: UiError | undefined) => void
  readonly t: Translator['t']
}

// Espacio duro, escrito con escape para que el linter no lo confunda con un descuido.
const NBSP = '\u00a0'

// Banda de una cuenta: el orden de pantalla separa las favoritas y, en la vista por grupo, las de la identidad propia.
export function accountBand(account: Account, view: 'identity' | 'group', ownIdentityId: string | undefined): string {
  const own = view === 'group' && account.identityId === ownIdentityId ? 'own' : 'rest'
  return `${account.favorite ? 'fav' : 'plain'}:${own}`
}

// Reordenar cuentas e identidades: movimiento por pasos (teclado y menú) y arrastrar y soltar (HTML5). Cada cambio es
// un solo data.mutate con una operación de reordenación. Los manejadores son estables: leen el estado más reciente de
// un ref, para no repintar todas las tarjetas en cada render.
export function useReorder(params: ReorderParams): {
  readonly actions: ReorderActions
  readonly drag: DragState
  readonly announcement: string
} {
  const [drag, setDrag] = useState<DragState>({ dragging: undefined, overId: undefined })
  const [announcement, setAnnouncement] = useState('')
  const latest = useRef(params)
  const dragging = useRef<Dragging | undefined>(undefined)
  const focusAfter = useRef<string | undefined>(undefined)
  const flip = useRef(false)
  // Último orden pedido por tipo y aún no visto en pantalla: `base` es la lista (por referencia) sobre la que se pidió.
  // Mientras la pantalla siga con esa lista, el siguiente movimiento parte del orden pedido y no del viejo.
  const pending = useRef(new Map<Dragging['kind'], { readonly base: unknown; readonly ids: readonly string[] }>())

  useEffect(() => {
    latest.current = params
  })

  // Tras mover una cuenta, el foco vuelve a su botón: mover el nodo del DOM puede haberlo perdido.
  useEffect(() => {
    const id = focusAfter.current
    if (id === undefined) return
    focusAfter.current = undefined
    document.querySelector<HTMLElement>(`li[data-account-id="${id}"] .tile__open`)?.focus()
  }, [params.sections])

  const say = useCallback((text: string): void => {
    // Un espacio final (NBSP) alterno hace que el mismo texto dos veces seguidas se vuelva a anunciar.
    flip.current = !flip.current
    setAnnouncement(flip.current ? text : `${text}${NBSP}`)
  }, [])

  // La lista tal como quedará tras los movimientos ya pedidos; sin ellos, o con datos nuevos, la misma lista.
  const withPending = useCallback(
    <T extends { readonly id: string }>(kind: Dragging['kind'], base: unknown, list: readonly T[]): readonly T[] => {
      const requested = pending.current.get(kind)
      if (requested === undefined || requested.base !== base || requested.ids.length !== list.length) return list
      const byId = new Map(list.map((item) => [item.id, item]))
      const ordered = requested.ids.flatMap((id) => byId.get(id) ?? [])
      return ordered.length === list.length ? ordered : list
    },
    [],
  )

  // Plan de un movimiento de cuenta: la lista de ids de su sección ya movida, o undefined si no hay movimiento.
  const planAccount = useCallback(
    (id: string, move: Move): string[] | undefined => {
      const { sections, view, ownIdentityId } = latest.current
      const section = sections.find((candidate) => candidate.accounts.some((account) => account.id === id))
      if (section === undefined) return undefined
      return moveIds(
        withPending('account', sections, section.accounts),
        id,
        move,
        (a, b) => accountBand(a, view, ownIdentityId) === accountBand(b, view, ownIdentityId),
      )
    },
    [withPending],
  )

  const planIdentity = useCallback(
    (id: string, move: Move): string[] | undefined => {
      const { identities, ownIdentityId } = latest.current
      return moveIds(
        withPending('identity', identities, identities),
        id,
        move,
        (a, b) => (a.id === ownIdentityId) === (b.id === ownIdentityId),
      )
    },
    [withPending],
  )

  const commit = useCallback(
    async (kind: Dragging['kind'], id: string, label: string, ids: string[]): Promise<void> => {
      const { mutate, onError, t, sections, identities } = latest.current
      if (kind === 'account') focusAfter.current = id
      const request = { base: kind === 'account' ? sections : identities, ids }
      pending.current.set(kind, request)
      const response = await mutate([{ type: kind === 'account' ? 'account.reorder' : 'identity.reorder', ids }])
      onError(response.ok ? undefined : response.error)
      if (response.ok) {
        say(t('reorder.moved', { label, position: ids.indexOf(id) + 1, total: ids.length }))
      } else {
        // Con otra petición en vuelo, su pending no es de esta: solo se borra el propio.
        if (pending.current.get(kind) === request) pending.current.delete(kind)
        focusAfter.current = undefined
      }
    },
    [say],
  )

  const run = useCallback(
    (kind: Dragging['kind'], id: string, label: string, move: Move): void => {
      const ids = kind === 'account' ? planAccount(id, move) : planIdentity(id, move)
      if (ids === undefined) {
        if ('step' in move) say(latest.current.t('reorder.edge', { label }))
        return
      }
      void commit(kind, id, label, ids)
    },
    [commit, planAccount, planIdentity, say],
  )

  const labelOf = useCallback((kind: Dragging['kind'], id: string): string => {
    const { sections, identities } = latest.current
    if (kind === 'identity') return identities.find((identity) => identity.id === id)?.label ?? ''
    for (const section of sections) {
      const found = section.accounts.find((account) => account.id === id)
      if (found !== undefined) return found.label
    }
    return ''
  }, [])

  const actions = useMemo<ReorderActions>(
    () => ({
      moveAccount: (account, delta) => {
        run('account', account.id, account.label, { step: delta })
      },
      moveIdentity: (identity, delta) => {
        run('identity', identity.id, identity.label, { step: delta })
      },
      dragStart: (kind, id, event) => {
        // Una cuenta dentro de una sección arrastrable: el arrastre de la sección no debe empezar.
        event.stopPropagation()
        dragging.current = { kind, id }
        event.dataTransfer.effectAllowed = 'move'
        // Firefox no inicia el arrastre sin datos.
        event.dataTransfer.setData('text/plain', id)
        setDrag({ dragging: { kind, id }, overId: undefined })
      },
      dragOver: (kind, id, event) => {
        const current = dragging.current
        if (current?.kind !== kind || current.id === id) return
        const move: Move = { to: id }
        if ((kind === 'account' ? planAccount(current.id, move) : planIdentity(current.id, move)) === undefined) return
        // Permitir soltar aquí.
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        setDrag((state) => (state.overId === id ? state : { ...state, overId: id }))
      },
      drop: (kind, id, event) => {
        const current = dragging.current
        // Otro tipo de elemento (una identidad soltada sobre una tarjeta): se deja pasar el evento sin vaciar el
        // arrastre, para que llegue a la sección, que sí lo trata.
        if (current?.kind !== kind) return
        dragging.current = undefined
        setDrag({ dragging: undefined, overId: undefined })
        event.preventDefault()
        event.stopPropagation()
        run(kind, current.id, labelOf(kind, current.id), { to: id })
      },
      dragEnd: () => {
        dragging.current = undefined
        setDrag({ dragging: undefined, overId: undefined })
      },
    }),
    [run, planAccount, planIdentity, labelOf],
  )

  return { actions, drag, announcement }
}
