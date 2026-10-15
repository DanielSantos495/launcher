import {
  buildSections,
  CATALOG,
  compareId,
  compareText,
  isolationWarnings,
  resolveTarget,
  serviceInfo,
  type Account,
  type Bindings,
  type Group,
  type Identity,
  type LauncherData,
  type OpenTarget,
  type ProfileInfo,
  type Section,
  type ServiceInfo,
} from '@account-launcher/core'

// Secciones de la vista: las de buildSections, pero en la vista por grupo las cuentas de la identidad propia van primero
// dentro de cada sección (el resto conserva su orden). En la vista por identidad, buildSections ya pone la propia primera.
export function viewSections(data: LauncherData, view: 'identity' | 'group', ownIdentityId?: string): Section[] {
  const sections = buildSections(data, view, ownIdentityId)
  if (view === 'identity' || ownIdentityId === undefined) return sections
  return sections.map((section) => {
    if (!section.accounts.some((account) => account.identityId === ownIdentityId)) return section
    const own = section.accounts.filter((account) => account.identityId === ownIdentityId)
    const rest = section.accounts.filter((account) => account.identityId !== ownIdentityId)
    return { ...section, accounts: [...own, ...rest] }
  })
}

// Dónde se abrirá una cuenta, listo para mostrarlo antes de abrir (T11). El nombre y el color solo están si el perfil
// aparece en la lista que devuelve el host.
export type Destination =
  | { readonly kind: 'current' }
  | { readonly kind: 'profile'; readonly directory: string; readonly name?: string; readonly color?: string }

function describeTarget(target: OpenTarget, profiles: readonly ProfileInfo[]): Destination {
  if (target.kind === 'current') return { kind: 'current' }
  const directory = target.profileDirectory
  const profile = profiles.find((candidate) => candidate.directory === directory)
  if (profile === undefined) return { kind: 'profile', directory }
  return {
    kind: 'profile',
    directory,
    name: profile.name,
    ...(profile.color === undefined ? {} : { color: profile.color }),
  }
}

export function destinationFor(
  account: Account,
  data: LauncherData,
  bindings: Bindings,
  profiles: readonly ProfileInfo[],
  asIdentityId?: string,
): Destination {
  return describeTarget(resolveTarget({ data, bindings }, account, asIdentityId), profiles)
}

// Destino de la identidad como tal (cabecera de su sección): el de sus cuentas sin excepción de contexto.
export function identityDestination(
  identityId: string,
  data: LauncherData,
  bindings: Bindings,
  profiles: readonly ProfileInfo[],
): Destination {
  if (data.settings.mode === 'single' || !Object.hasOwn(bindings, identityId)) return { kind: 'current' }
  const binding = bindings[identityId]
  return binding?.kind === 'chromium-profile'
    ? describeTarget({ kind: 'chromium-profile', profileDirectory: binding.profileDirectory }, profiles)
    : { kind: 'current' }
}

export function sameDestination(a: Destination, b: Destination): boolean {
  if (a.kind === 'current' || b.kind === 'current') return a.kind === b.kind
  return a.directory === b.directory
}

// Para cada cuenta, las otras que comparten sesión con ella (isolationWarnings de core). Solo están las que tienen avisos.
export function warningsIndex(data: LauncherData, bindings: Bindings): ReadonlyMap<string, readonly Account[]> {
  const index = new Map<string, readonly Account[]>()
  const ctx = { data, bindings }
  for (const account of data.accounts) {
    const shared = isolationWarnings(ctx, account)
    if (shared.length > 0) index.set(account.id, shared)
  }
  return index
}

// Identidades y grupos en el orden de las secciones (orden, nombre e id), para los selectores y menús.
export function orderedIdentities(data: LauncherData, ownIdentityId?: string): Identity[] {
  const list = [...data.identities].sort(
    (a, b) => a.order - b.order || compareText(a.label, b.label) || compareId(a.id, b.id),
  )
  const own = list.findIndex((identity) => identity.id === ownIdentityId)
  if (own > 0) list.unshift(...list.splice(own, 1))
  return list
}

export function orderedGroups(data: LauncherData): Group[] {
  return [...data.groups].sort((a, b) => a.order - b.order || compareText(a.name, b.name) || compareId(a.id, b.id))
}

// Tablas de búsqueda por id y destinos de cada cuenta e identidad. Se calculan una vez por cambio de datos.
export interface BoardIndex {
  readonly identities: ReadonlyMap<string, Identity>
  readonly groups: ReadonlyMap<string, Group>
  readonly services: ReadonlyMap<string, ServiceInfo>
  readonly destinations: ReadonlyMap<string, Destination>
  readonly identityDestinations: ReadonlyMap<string, Destination>
}

export function boardIndex(data: LauncherData, bindings: Bindings, profiles: readonly ProfileInfo[]): BoardIndex {
  const services = new Map<string, ServiceInfo>()
  const serviceIds = [...CATALOG.map((service) => service.id), ...data.customServices.map((s) => `custom:${s.id}`)]
  for (const id of serviceIds) {
    const info = serviceInfo(data, id)
    if (info !== undefined) services.set(id, info)
  }
  return {
    identities: new Map(data.identities.map((identity) => [identity.id, identity])),
    groups: new Map(data.groups.map((group) => [group.id, group])),
    services,
    destinations: new Map(
      data.accounts.map((account) => [account.id, destinationFor(account, data, bindings, profiles)]),
    ),
    identityDestinations: new Map(
      data.identities.map((identity) => [identity.id, identityDestination(identity.id, data, bindings, profiles)]),
    ),
  }
}
