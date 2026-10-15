import type { Account, Identity, ServiceInfo } from '@account-launcher/core'
import { memo, useId } from 'react'
import type { Language } from '../../i18n/i18n'
import { useI18n, type I18n } from '../i18n-context'
import type { Destination } from '../lib/sections'
import { AccountMenu } from './AccountMenu'
import { DestinationLabel } from './DestinationLabel'
import { Icon } from './Icon'

// Acciones de una tarjeta. El objeto debe ser estable entre renders para que memo evite repintar tarjetas.
export interface AccountActions {
  readonly open: (account: Account, asIdentityId?: string) => void
  readonly toggleFavorite: (account: Account) => void
  readonly edit: (account: Account) => void
  readonly remove: (account: Account) => void
}

export interface AccountTileProps {
  readonly account: Account
  readonly service: ServiceInfo | undefined
  // Identidad dueña: solo se muestra (con su punto de color) en la vista por grupo.
  readonly identity: Identity | undefined
  readonly identities: readonly Identity[]
  // undefined = no mostrar el destino.
  readonly destination: Destination | undefined
  readonly sharedWith: readonly Account[]
  readonly actions: AccountActions
}

const MAX_NAMED = 3
// Un formato por idioma y tipo: "A, B y C" para el cierre de la frase y "A, B, C" cuando después viene "y N más".
const listFormats = new Map<string, Intl.ListFormat>()

function listFormat(language: Language, type: 'conjunction' | 'unit'): Intl.ListFormat {
  const key = `${language}:${type}`
  let format = listFormats.get(key)
  if (format === undefined) {
    format = new Intl.ListFormat(language, { style: type === 'unit' ? 'short' : 'long', type })
    listFormats.set(key, format)
  }
  return format
}

// "Comparte sesión con «A», «B» y «C»": nombra hasta tres cuentas y cuenta el resto.
function sharedText(accounts: readonly Account[], { t, language }: I18n): string {
  const named = accounts.slice(0, MAX_NAMED).map((other) => t('common.quoted', { text: other.label }))
  const rest = accounts.length - named.length
  const names = listFormat(language, rest > 0 ? 'unit' : 'conjunction').format(named)
  return rest > 0 ? t('tile.sharedWith.more', { names, count: rest }) : t('tile.sharedWith', { names })
}

// Tarjeta de una cuenta. El botón principal cubre toda la tarjeta (el clic abre); la estrella y el menú van por encima.
export const AccountTile = memo(function AccountTile({
  account,
  service,
  identity,
  identities,
  destination,
  sharedWith,
  actions,
}: AccountTileProps) {
  const i18n = useI18n()
  const { t } = i18n
  const extraId = useId()
  const secondary =
    account.username ?? (service !== undefined && service.name !== account.label ? service.name : undefined)
  const warning = sharedWith.length > 0 ? sharedText(sharedWith, i18n) : undefined
  const describedBy = [
    secondary === undefined ? undefined : `${extraId}-meta`,
    identity === undefined ? undefined : `${extraId}-identity`,
    destination === undefined ? undefined : `${extraId}-destination`,
    warning === undefined ? undefined : `${extraId}-warning`,
  ]
    .filter((id) => id !== undefined)
    .join(' ')

  return (
    <li className="tile">
      <button
        type="button"
        className="tile__open"
        aria-labelledby={`${extraId}-label`}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        onClick={() => {
          actions.open(account)
        }}
      >
        <Icon icon={account.icon} serviceIcon={service?.icon} />
        <span className="tile__text">
          <span id={`${extraId}-label`} className="tile__label">
            {account.label}
          </span>
          {secondary === undefined ? null : (
            <span id={`${extraId}-meta`} className="tile__meta">
              {secondary}
            </span>
          )}
        </span>
      </button>
      <div className="tile__tools">
        <button
          type="button"
          className="icon-button tile__star"
          aria-pressed={account.favorite}
          aria-label={t('tile.favorite', { label: account.label })}
          onClick={() => {
            actions.toggleFavorite(account)
          }}
        >
          <span aria-hidden="true">{account.favorite ? '★' : '☆'}</span>
        </button>
        <AccountMenu
          account={account}
          identities={identities}
          onEdit={actions.edit}
          onDelete={actions.remove}
          onOpenAs={actions.open}
        />
      </div>
      {identity === undefined ? null : (
        <p id={`${extraId}-identity`} className="tile__line tile__meta">
          <span className="dot" style={{ backgroundColor: identity.color }} aria-hidden="true" />
          {identity.label}
        </p>
      )}
      {destination === undefined ? null : (
        <p id={`${extraId}-destination`} className="tile__line tile__meta">
          <DestinationLabel destination={destination} />
        </p>
      )}
      {warning === undefined ? null : (
        <p id={`${extraId}-warning`} className="tile__line tile__warning">
          {warning}
        </p>
      )}
    </li>
  )
})
