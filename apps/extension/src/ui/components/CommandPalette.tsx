import { searchAccounts, type Account, type LauncherData } from '@account-launcher/core'
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n-context'
import type { BoardIndex } from '../lib/sections'
import { DestinationLabel } from './DestinationLabel'
import { Dialog } from './Dialog'
import { Icon } from './Icon'

interface CommandPaletteProps {
  readonly data: LauncherData
  readonly index: BoardIndex
  // Solo en Varios perfiles se muestra dónde abre cada cuenta.
  readonly showDestinations: boolean
  // Abre la cuenta elegida; quien la recibe cierra la paleta.
  readonly onOpen: (account: Account) => void
  readonly onClose: () => void
}

const MAX_RESULTS = 50

// Paleta Ctrl+K: combobox WAI-ARIA con listbox. El foco se queda siempre en el campo y la opción activa se indica con
// aria-activedescendant. Los resultados vienen de searchAccounts de core, que compara texto sin construir expresiones
// regulares con la consulta.
export function CommandPalette({ data, index, showDestinations, onOpen, onClose }: CommandPaletteProps) {
  const { t, tp } = useI18n()
  const [query, setQuery] = useState('')
  // La consulta se aplaza para que escribir no espere a repintar la lista.
  const deferredQuery = useDeferredValue(query)
  // Posición pedida por el teclado; la activa se acota al número de resultados (que cambia al escribir).
  const [cursor, setCursor] = useState(0)
  // Instante de apertura: fija "abierta hace poco" mientras la paleta está abierta.
  const [openedAt] = useState(() => new Date())
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)

  const hits = useMemo(
    () => searchAccounts(data, deferredQuery, { limit: MAX_RESULTS, now: openedAt }),
    [data, deferredQuery, openedAt],
  )
  const last = hits.length - 1
  const active = Math.min(cursor, last)
  const optionId = (position: number): string => `${listId}-${String(position)}`

  // Mantiene visible la opción activa al moverse por una lista larga.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    let next: number | undefined
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(active + 1, last)
        break
      case 'ArrowUp':
        next = Math.max(active - 1, 0)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      case 'Enter': {
        const hit = hits[active]
        if (hit === undefined) return
        event.preventDefault()
        onOpen(hit.account)
        return
      }
      default:
        return
    }
    // Sin resultados no hay a dónde moverse; el campo conserva sus teclas.
    if (hits.length === 0) return
    event.preventDefault()
    setCursor(next)
  }

  return (
    <Dialog title={t('palette.label')} onClose={onClose} bare>
      <input
        className="palette__input"
        role="combobox"
        aria-label={t('palette.input')}
        aria-expanded={hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={hits.length > 0 ? optionId(active) : undefined}
        placeholder={t('palette.input')}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setCursor(0)
        }}
        onKeyDown={onKeyDown}
      />
      <p className={hits.length === 0 ? 'palette__empty' : 'visually-hidden'} role="status">
        {hits.length === 0
          ? t('palette.empty', { query: deferredQuery })
          : tp('palette.count', hits.length, { count: hits.length })}
      </p>
      {hits.length === 0 ? null : (
        <ul ref={listRef} id={listId} className="palette__list" role="listbox" aria-label={t('palette.label')}>
          {hits.map(({ account }, position) => {
            const identity = index.identities.get(account.identityId)
            const service = index.services.get(account.serviceId)
            const destination = showDestinations ? index.destinations.get(account.id) : undefined
            return (
              <li
                key={account.id}
                id={optionId(position)}
                role="option"
                aria-selected={position === active}
                className="palette__option"
                onClick={() => {
                  onOpen(account)
                }}
              >
                <Icon icon={account.icon} serviceIcon={service?.icon} size={24} />
                <span className="palette__text">
                  <span className="palette__label">{account.label}</span>
                  {service === undefined ? null : <span className="palette__meta">{service.name}</span>}
                </span>
                {identity === undefined ? null : (
                  <span className="palette__meta">
                    <span className="dot" style={{ backgroundColor: identity.color }} aria-hidden="true" />
                    {identity.label}
                  </span>
                )}
                {destination === undefined ? null : (
                  <span className="palette__meta">
                    <DestinationLabel destination={destination} />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="palette__help">{t('palette.help')}</p>
    </Dialog>
  )
}
