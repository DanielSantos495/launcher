import { compareId, compareText } from './compare'
import type { Account, LauncherData } from './schema'

export interface Section {
  readonly key: string
  readonly identityId?: string
  readonly groupId?: string | null
  readonly accounts: readonly Account[]
}

// Favoritas primero, luego orden, etiqueta e id: el orden es total y no depende del de entrada.
export function sortAccounts(accounts: readonly Account[]): Account[] {
  return [...accounts].sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      a.order - b.order ||
      compareText(a.label, b.label) ||
      compareId(a.id, b.id),
  )
}

// buildSections ordena el dashboard. Sin textos: la UI traduce las claves ("ungrouped", nombres propios).
export function buildSections(data: LauncherData, view: 'identity' | 'group', ownIdentityId?: string): Section[] {
  if (view === 'identity') {
    const identities = [...data.identities].sort(
      (a, b) => a.order - b.order || compareText(a.label, b.label) || compareId(a.id, b.id),
    )
    const own = identities.findIndex((i) => i.id === ownIdentityId)
    if (own > 0) identities.unshift(...identities.splice(own, 1))
    return identities.map((i) => ({
      key: `identity:${i.id}`,
      identityId: i.id,
      accounts: sortAccounts(data.accounts.filter((a) => a.identityId === i.id)),
    }))
  }
  const groups = [...data.groups].sort(
    (a, b) => a.order - b.order || compareText(a.name, b.name) || compareId(a.id, b.id),
  )
  const sections: Section[] = groups.map((g) => ({
    key: `group:${g.id}`,
    groupId: g.id,
    accounts: sortAccounts(data.accounts.filter((a) => a.groupId === g.id)),
  }))
  const ungrouped = data.accounts.filter((a) => a.groupId === null)
  if (ungrouped.length > 0) sections.push({ key: 'ungrouped', groupId: null, accounts: sortAccounts(ungrouped) })
  return sections
}
