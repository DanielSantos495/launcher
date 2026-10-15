import type { Account, Group, Identity, IconRef, Section } from '@account-launcher/core'
import { useI18n } from '../i18n-context'
import { sameDestination, type BoardIndex } from '../lib/sections'
import { AccountTile, type AccountActions } from './AccountTile'
import { EmptyState } from './EmptyState'
import type { MenuItem } from './Menu'
import { SectionHeader } from './SectionHeader'

// Acciones de las cabeceras de sección. El objeto debe ser estable entre renders.
export interface SectionActions {
  readonly addAccount: (target: { readonly identityId?: string; readonly groupId?: string }) => void
  readonly editIdentity: (identity: Identity) => void
  readonly deleteIdentity: (identity: Identity) => void
  readonly editGroup: (group: Group) => void
  readonly deleteGroup: (group: Group) => void
}

interface SectionListProps {
  readonly sections: readonly Section[]
  readonly view: 'identity' | 'group'
  // Solo en Varios perfiles se muestra dónde abre cada cosa.
  readonly showDestinations: boolean
  readonly index: BoardIndex
  // Todas las identidades en orden, para "Abrir como…".
  readonly identities: readonly Identity[]
  readonly warnings: ReadonlyMap<string, readonly Account[]>
  readonly tileActions: AccountActions
  readonly sectionActions: SectionActions
}

const NO_WARNINGS: readonly Account[] = []
const FOLDER: IconRef = { type: 'bundled', name: 'folder' }

export function SectionList({
  sections,
  view,
  showDestinations,
  index,
  identities,
  warnings,
  tileActions,
  sectionActions,
}: SectionListProps) {
  const { t } = useI18n()

  return (
    <div className="sections">
      {sections.map((section) => {
        const identity = section.identityId === undefined ? undefined : index.identities.get(section.identityId)
        const groupId = section.groupId ?? undefined
        const group = groupId === undefined ? undefined : index.groups.get(groupId)
        const target = identity === undefined ? { groupId: group?.id } : { identityId: identity.id }
        const sectionDestination =
          showDestinations && identity !== undefined ? index.identityDestinations.get(identity.id) : undefined

        const add: MenuItem = {
          key: 'add',
          label: t('section.addAccount'),
          onSelect: () => {
            sectionActions.addAccount(target)
          },
        }
        const menuItems: MenuItem[] = [add]
        if (identity !== undefined) {
          menuItems.push(
            {
              key: 'edit',
              label: t('section.editIdentity'),
              onSelect: () => {
                sectionActions.editIdentity(identity)
              },
            },
            {
              key: 'delete',
              label: t('section.deleteIdentity'),
              danger: true,
              onSelect: () => {
                sectionActions.deleteIdentity(identity)
              },
            },
          )
        } else if (group !== undefined) {
          menuItems.push(
            {
              key: 'edit',
              label: t('section.editGroup'),
              onSelect: () => {
                sectionActions.editGroup(group)
              },
            },
            {
              key: 'delete',
              label: t('section.deleteGroup'),
              danger: true,
              onSelect: () => {
                sectionActions.deleteGroup(group)
              },
            },
          )
        }

        const title = identity?.label ?? group?.name ?? t('section.ungrouped')
        const color = identity?.color ?? group?.color
        return (
          <section key={section.key} className="section">
            <div
              className={color === undefined ? 'section__ribbon section__ribbon--neutral' : 'section__ribbon'}
              style={color === undefined ? undefined : { backgroundColor: color }}
              aria-hidden="true"
            />
            <div className="section__body">
              <SectionHeader
                title={title}
                count={section.accounts.length}
                menuItems={menuItems}
                {...(identity?.email === undefined ? {} : { subtitle: identity.email })}
                {...(group === undefined ? {} : { icon: group.icon ?? FOLDER })}
                {...(sectionDestination === undefined ? {} : { destination: sectionDestination })}
              />
              {section.accounts.length === 0 ? (
                <EmptyState
                  compact
                  title={t('section.empty')}
                  action={{ label: t('section.addAccount'), onClick: add.onSelect }}
                />
              ) : (
                <ul className="grid">
                  {section.accounts.map((account) => {
                    const destination = index.destinations.get(account.id)
                    const showOwn =
                      showDestinations &&
                      destination !== undefined &&
                      (view === 'group' ||
                        sectionDestination === undefined ||
                        !sameDestination(destination, sectionDestination))
                    return (
                      <AccountTile
                        key={account.id}
                        account={account}
                        service={index.services.get(account.serviceId)}
                        identity={view === 'group' ? index.identities.get(account.identityId) : undefined}
                        identities={identities}
                        destination={showOwn ? destination : undefined}
                        sharedWith={warnings.get(account.id) ?? NO_WARNINGS}
                        actions={tileActions}
                      />
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
