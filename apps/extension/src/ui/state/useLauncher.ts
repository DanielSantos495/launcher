import type { Bindings, LauncherData, Op, ProfileInfo } from '@account-launcher/core'
import type { Capabilities, UiError, UiResponse, UiResults } from '@account-launcher/protocol'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { InstallationView, LauncherClient } from '../client'

export interface LauncherState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly error?: UiError
  readonly data?: LauncherData
  readonly source?: 'local' | 'shared'
  readonly bindings: Bindings
  readonly installation?: InstallationView
  readonly capabilities?: Capabilities
  readonly profiles: readonly ProfileInfo[]
}

export interface Launcher {
  readonly state: LauncherState
  readonly mutate: (ops: Op[]) => Promise<UiResponse<UiResults['data.mutate']>>
  readonly send: LauncherClient['send']
  readonly reload: () => Promise<void>
}

export const REFRESH_MS = 30_000
// Agrupa los avisos seguidos de storage.onChanged (una escritura suele cambiar varias claves).
const CHANGE_DEBOUNCE_MS = 100

const INITIAL: LauncherState = { status: 'loading', bindings: {}, profiles: [] }

// Una respuesta llega tarde si el componente se desmontó o si ya empezó una carga más reciente. Es una función aparte
// para que TypeScript no dé por fijo el valor del ref entre dos await.
function isStale(alive: RefObject<boolean>, counter: RefObject<number>, seq: number): boolean {
  return !alive.current || counter.current !== seq
}

// Estado del dashboard: lo lee del service worker y del almacenamiento, y lo mantiene al día con los avisos del
// navegador. El cliente debe ser estable entre renders (se crea una vez).
export function useLauncher(client: LauncherClient): Launcher {
  const [state, setState] = useState<LauncherState>(INITIAL)
  // Espejo del último estado para los callbacks de eventos y temporizadores (evita cierres con estado viejo). Solo se
  // escribe desde commit, nunca durante el render.
  const latest = useRef<LauncherState>(INITIAL)
  const alive = useRef(false)
  // Cada carga lleva un número: si llega una respuesta de una carga anterior, se descarta.
  const coreSeq = useRef(0)
  const hostSeq = useRef(0)
  // Evita avisos dobles cuando focus y visibilitychange llegan juntos.
  const waking = useRef(false)

  const commit = useCallback((update: (current: LauncherState) => LauncherState): void => {
    latest.current = update(latest.current)
    setState(latest.current)
  }, [])

  // Datos, vínculos e instalación. Si data.get falla, el estado pasa a error con su código.
  const loadCore = useCallback(async (): Promise<void> => {
    const seq = ++coreSeq.current
    const [data, bindings, installation] = await Promise.all([
      client.send({ type: 'data.get' }),
      client.send({ type: 'bindings.get' }),
      client.installation(),
    ])
    if (isStale(alive, coreSeq, seq)) return
    // Con el error también se guarda la instalación: decide qué aviso se enseña (¿está emparejada?).
    if (!data.ok) {
      commit((current) => ({ ...current, status: 'error', error: data.error, installation }))
      return
    }
    if (!bindings.ok) {
      commit((current) => ({ ...current, status: 'error', error: bindings.error, installation }))
      return
    }
    commit((current) => ({
      ...current,
      status: 'ready',
      error: undefined,
      data: data.result.data,
      source: data.result.source,
      bindings: bindings.result.bindings,
      installation,
    }))
  }, [client, commit])

  // Capacidades y, si el host responde, la lista de perfiles. No bloquea la carga de los datos: un host lento solo
  // retrasa esto.
  const loadHost = useCallback(async (): Promise<void> => {
    const seq = ++hostSeq.current
    const capabilities = await client.send({ type: 'capabilities.get' })
    if (isStale(alive, hostSeq, seq)) return
    if (!capabilities.ok || !capabilities.result.host.available) {
      commit((current) => ({
        ...current,
        capabilities: capabilities.ok ? capabilities.result : undefined,
        profiles: [],
      }))
      return
    }
    commit((current) => ({ ...current, capabilities: capabilities.result }))
    const listed = await client.send({ type: 'profiles.list' })
    if (isStale(alive, hostSeq, seq)) return
    // Si la consulta falla se conserva la lista anterior: un fallo puntual no debe vaciar los nombres de los perfiles.
    if (listed.ok) commit((current) => ({ ...current, profiles: listed.result.profiles }))
  }, [client, commit])

  // Tras un cambio en el almacenamiento: recarga los datos y, si cambió el modo, también las capacidades.
  const reloadAfterChange = useCallback(async (): Promise<void> => {
    const before = latest.current.data?.settings.mode
    await loadCore()
    if (alive.current && latest.current.data?.settings.mode !== before) await loadHost()
  }, [loadCore, loadHost])

  // Carga inicial y avisos de storage.onChanged.
  useEffect(() => {
    alive.current = true
    void loadCore()
    void loadHost()
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = client.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void reloadAfterChange()
      }, CHANGE_DEBOUNCE_MS)
    })
    return () => {
      alive.current = false
      clearTimeout(timer)
      unsubscribe()
    }
  }, [client, loadCore, loadHost, reloadAfterChange])

  // Al volver a la ventana: sync.refresh si los datos son compartidos (los cambios llegan por subscribe) y capacidades.
  useEffect(() => {
    const wake = (): void => {
      if (waking.current) return
      waking.current = true
      const sync =
        latest.current.source === 'shared' ? client.send({ type: 'sync.refresh' }) : Promise.resolve(undefined)
      void Promise.all([sync, loadHost()]).finally(() => {
        waking.current = false
      })
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') wake()
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [client, loadHost])

  // Datos compartidos: un sync.refresh al abrir (una instalación revocada deja de servir su caché) y otro cada 30 s.
  const source = state.source
  useEffect(() => {
    if (source !== 'shared') return
    const refresh = (): void => {
      void client.send({ type: 'sync.refresh' })
    }
    refresh()
    const interval = setInterval(refresh, REFRESH_MS)
    return () => {
      clearInterval(interval)
    }
  }, [client, source])

  const mutate = useCallback(
    async (ops: Op[]): Promise<UiResponse<UiResults['data.mutate']>> => {
      // La revisión no bloquea (DC3): el service worker reaplica las operaciones sobre el último estado.
      const response = await client.send({ type: 'data.mutate', revision: latest.current.data?.revision ?? 0, ops })
      if (response.ok) await reloadAfterChange()
      return response
    },
    [client, reloadAfterChange],
  )

  const send = useCallback<LauncherClient['send']>((request) => client.send(request), [client])

  const reload = useCallback(async (): Promise<void> => {
    await Promise.all([loadCore(), loadHost()])
  }, [loadCore, loadHost])

  return { state, mutate, send, reload }
}
