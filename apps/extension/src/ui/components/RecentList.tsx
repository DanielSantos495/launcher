import type { Account } from '@account-launcher/core'
import { useI18n } from '../i18n-context'
import type { BoardIndex } from '../lib/sections'
import { AccountTile, type AccountActions } from './AccountTile'
import { EmptyState } from './EmptyState'

interface RecentListProps {
  // Las cuentas ya elegidas y ordenadas (recentAccounts de core).
  readonly accounts: readonly Account[]
  readonly index: BoardIndex
  readonly identities: Parameters<typeof AccountTile>[0]['identities']
  readonly tileActions: AccountActions
}

const NO_SHARED: readonly Account[] = []

// Vista "Recientes": las últimas cuentas abiertas, sin secciones y sin reordenar (el orden es la fecha de apertura).
export function RecentList({ accounts, index, identities, tileActions }: RecentListProps) {
  const { t } = useI18n()
  if (accounts.length === 0) {
    return <EmptyState title={t('recent.empty.title')} body={t('recent.empty.body')} />
  }
  return (
    <section className="recent" aria-labelledby="recent-title">
      <h2 id="recent-title" className="recent__title">
        {t('recent.title')}
      </h2>
      <ul className="grid">
        {accounts.map((account) => (
          <AccountTile
            key={account.id}
            account={account}
            service={index.services.get(account.serviceId)}
            identity={index.identities.get(account.identityId)}
            identities={identities}
            destination={undefined}
            sharedWith={NO_SHARED}
            actions={tileActions}
          />
        ))}
      </ul>
    </section>
  )
}
