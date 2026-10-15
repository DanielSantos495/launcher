import type { Account, Identity } from '@account-launcher/core'
import { useI18n } from '../i18n-context'
import { Menu, type MenuItem } from './Menu'

interface AccountMenuProps {
  readonly account: Account
  // Todas las identidades en orden: "Abrir como…" ofrece las demás.
  readonly identities: readonly Identity[]
  readonly onEdit: (account: Account) => void
  readonly onDelete: (account: Account) => void
  readonly onOpenAs: (account: Account, identityId: string) => void
}

export function AccountMenu({ account, identities, onEdit, onDelete, onOpenAs }: AccountMenuProps) {
  const { t } = useI18n()
  const items: MenuItem[] = [
    {
      key: 'edit',
      label: t('common.edit'),
      onSelect: () => {
        onEdit(account)
      },
    },
    ...identities
      .filter((identity) => identity.id !== account.identityId)
      .map((identity): MenuItem => ({
        key: `as:${identity.id}`,
        label: t('tile.openAs', { identity: identity.label }),
        onSelect: () => {
          onOpenAs(account, identity.id)
        },
      })),
    {
      key: 'delete',
      label: t('common.delete'),
      danger: true,
      onSelect: () => {
        onDelete(account)
      },
    },
  ]
  return <Menu label={t('tile.menu', { label: account.label })} items={items} />
}
