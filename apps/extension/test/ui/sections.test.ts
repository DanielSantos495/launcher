import {
  createEmptyData,
  type Account,
  type Bindings,
  type Group,
  type Identity,
  type LauncherData,
  type ProfileInfo,
} from '@account-launcher/core'
import { describe, expect, it } from 'vitest'
import {
  boardIndex,
  destinationFor,
  identityDestination,
  orderedGroups,
  orderedIdentities,
  sameDestination,
  viewSections,
  warningsIndex,
} from '../../src/ui/lib/sections'

const AT = '2026-10-01T10:00:00.000Z'

function identity(id: string, order = 0): Identity {
  return { id, label: id, color: '#336699', order, createdAt: AT, updatedAt: AT }
}

function group(id: string, order = 0): Group {
  return { id, name: id, color: '#aa5500', order, createdAt: AT, updatedAt: AT }
}

function account(id: string, identityId: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    identityId,
    groupId: null,
    serviceId: 'github',
    label: id,
    icon: { type: 'auto' },
    favorite: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  }
}

function dataOf(
  parts: {
    identities?: Identity[]
    groups?: Group[]
    accounts?: Account[]
    mode?: 'single' | 'multi'
  } = {},
): LauncherData {
  const empty = createEmptyData()
  return {
    ...empty,
    identities: parts.identities ?? [],
    groups: parts.groups ?? [],
    accounts: parts.accounts ?? [],
    settings: { ...empty.settings, mode: parts.mode ?? 'single' },
  }
}

const PROFILES: ProfileInfo[] = [
  { directory: 'Default', name: 'Trabajo', isUsingDefaultName: false, color: '#112233' },
  { directory: 'Profile 1', name: 'Persona 1', isUsingDefaultName: true },
]

describe('viewSections', () => {
  const data = dataOf({
    identities: [identity('ana', 0), identity('beto', 1), identity('propia', 2)],
    groups: [group('g1', 0), group('g2', 1)],
    accounts: [
      account('a1', 'ana', { groupId: 'g1', order: 0 }),
      account('b1', 'beto', { groupId: 'g1', order: 1 }),
      account('p1', 'propia', { groupId: 'g1', order: 2 }),
      account('a2', 'ana', { groupId: 'g2', order: 0 }),
      account('b2', 'beto', { groupId: null, order: 0 }),
    ],
  })

  it('en la vista por identidad la propia va primera', () => {
    expect(viewSections(data, 'identity', 'propia').map((s) => s.identityId)).toEqual(['propia', 'ana', 'beto'])
  })

  it('sin identidad propia conserva el orden normal', () => {
    expect(viewSections(data, 'identity').map((s) => s.identityId)).toEqual(['ana', 'beto', 'propia'])
  })

  it('en la vista por grupo, las cuentas de la identidad propia van primero y el resto conserva el orden', () => {
    const sections = viewSections(data, 'group', 'propia')
    expect(sections.map((s) => [s.key, s.accounts.map((a) => a.id)])).toEqual([
      ['group:g1', ['p1', 'a1', 'b1']],
      ['group:g2', ['a2']],
      ['ungrouped', ['b2']],
    ])
  })

  it('en la vista por grupo sin identidad propia coincide con buildSections', () => {
    expect(viewSections(data, 'group').map((s) => [s.key, s.accounts.map((a) => a.id)])).toEqual([
      ['group:g1', ['a1', 'b1', 'p1']],
      ['group:g2', ['a2']],
      ['ungrouped', ['b2']],
    ])
  })

  it('la sección "sin grupo" solo existe si hay cuentas sin grupo y va al final', () => {
    const withoutUngrouped = dataOf({
      identities: [identity('ana')],
      groups: [group('g1')],
      accounts: [account('a1', 'ana', { groupId: 'g1' })],
    })
    expect(viewSections(withoutUngrouped, 'group').map((s) => s.key)).toEqual(['group:g1'])
  })
})

describe('destinationFor', () => {
  const accounts = [account('a1', 'ana'), account('b1', 'beto'), account('c1', 'ana', { contextOverride: 'current' })]
  const multi = dataOf({ identities: [identity('ana'), identity('beto')], accounts, mode: 'multi' })
  const bindings: Bindings = { ana: { kind: 'chromium-profile', profileDirectory: 'Default' } }

  it('en Perfil único siempre es la ventana actual', () => {
    const single = { ...multi, settings: { ...multi.settings, mode: 'single' as const } }
    expect(destinationFor(accounts[0] as Account, single, bindings, PROFILES)).toEqual({ kind: 'current' })
  })

  it('en Varios perfiles con vínculo y perfil conocido da el perfil con su nombre y color', () => {
    expect(destinationFor(accounts[0] as Account, multi, bindings, PROFILES)).toEqual({
      kind: 'profile',
      directory: 'Default',
      name: 'Trabajo',
      color: '#112233',
    })
  })

  it('con un perfil sin color no lleva color', () => {
    const other: Bindings = { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } }
    const destination = destinationFor(accounts[0] as Account, multi, other, PROFILES)
    expect(destination).toEqual({ kind: 'profile', directory: 'Profile 1', name: 'Persona 1' })
    expect(Object.hasOwn(destination, 'color')).toBe(false)
  })

  it('con un perfil desconocido (host sin responder) da la carpeta sin nombre', () => {
    expect(destinationFor(accounts[0] as Account, multi, bindings, [])).toEqual({
      kind: 'profile',
      directory: 'Default',
    })
  })

  it('sin vínculo es la ventana actual', () => {
    expect(destinationFor(accounts[1] as Account, multi, bindings, PROFILES)).toEqual({ kind: 'current' })
  })

  it('contextOverride current gana al vínculo', () => {
    expect(destinationFor(accounts[2] as Account, multi, bindings, PROFILES)).toEqual({ kind: 'current' })
  })

  it('abrir como una identidad vinculada da su perfil', () => {
    expect(destinationFor(accounts[1] as Account, multi, bindings, PROFILES, 'ana')).toEqual({
      kind: 'profile',
      directory: 'Default',
      name: 'Trabajo',
      color: '#112233',
    })
  })
})

describe('identityDestination', () => {
  const multi = dataOf({ identities: [identity('ana'), identity('beto')], mode: 'multi' })
  const bindings: Bindings = {
    ana: { kind: 'chromium-profile', profileDirectory: 'Default' },
    beto: { kind: 'current' },
  }

  it('da el perfil vinculado, o la ventana actual sin vínculo o con vínculo current', () => {
    expect(identityDestination('ana', multi, bindings, PROFILES)).toEqual({
      kind: 'profile',
      directory: 'Default',
      name: 'Trabajo',
      color: '#112233',
    })
    expect(identityDestination('beto', multi, bindings, PROFILES)).toEqual({ kind: 'current' })
    expect(identityDestination('otra', multi, bindings, PROFILES)).toEqual({ kind: 'current' })
  })

  it('en Perfil único ignora los vínculos', () => {
    const single = { ...multi, settings: { ...multi.settings, mode: 'single' as const } }
    expect(identityDestination('ana', single, bindings, PROFILES)).toEqual({ kind: 'current' })
  })

  it('un identificador con nombre de prototipo no toma nada heredado', () => {
    expect(identityDestination('toString', multi, bindings, PROFILES)).toEqual({ kind: 'current' })
  })
})

describe('sameDestination', () => {
  it('compara el tipo y la carpeta', () => {
    expect(sameDestination({ kind: 'current' }, { kind: 'current' })).toBe(true)
    expect(sameDestination({ kind: 'current' }, { kind: 'profile', directory: 'D' })).toBe(false)
    expect(sameDestination({ kind: 'profile', directory: 'D' }, { kind: 'current' })).toBe(false)
    expect(sameDestination({ kind: 'profile', directory: 'D', name: 'x' }, { kind: 'profile', directory: 'D' })).toBe(
      true,
    )
    expect(sameDestination({ kind: 'profile', directory: 'D' }, { kind: 'profile', directory: 'E' })).toBe(false)
  })
})

describe('warningsIndex', () => {
  it('dos Claude de identidades distintas en Perfil único se avisan entre sí', () => {
    const data = dataOf({
      identities: [identity('ana'), identity('beto')],
      accounts: [account('c1', 'ana', { serviceId: 'claude' }), account('c2', 'beto', { serviceId: 'claude' })],
    })
    const index = warningsIndex(data, {})
    expect(index.get('c1')?.map((a) => a.id)).toEqual(['c2'])
    expect(index.get('c2')?.map((a) => a.id)).toEqual(['c1'])
  })

  it('dos Gmail no se avisan: admiten sesiones en paralelo', () => {
    const data = dataOf({
      identities: [identity('ana'), identity('beto')],
      accounts: [
        account('m1', 'ana', { serviceId: 'google.gmail' }),
        account('m2', 'beto', { serviceId: 'google.gmail' }),
      ],
    })
    expect(warningsIndex(data, {}).size).toBe(0)
  })

  it('en Varios perfiles con cada identidad en su perfil no hay avisos', () => {
    const data = dataOf({
      identities: [identity('ana'), identity('beto')],
      accounts: [account('c1', 'ana', { serviceId: 'claude' }), account('c2', 'beto', { serviceId: 'claude' })],
      mode: 'multi',
    })
    const bindings: Bindings = {
      ana: { kind: 'chromium-profile', profileDirectory: 'Default' },
      beto: { kind: 'chromium-profile', profileDirectory: 'Profile 1' },
    }
    expect(warningsIndex(data, bindings).size).toBe(0)
  })

  it('una cuenta sola de su servicio no tiene aviso', () => {
    const data = dataOf({ identities: [identity('ana')], accounts: [account('c1', 'ana', { serviceId: 'claude' })] })
    expect(warningsIndex(data, {}).has('c1')).toBe(false)
  })
})

describe('orderedIdentities y orderedGroups', () => {
  const data = dataOf({
    identities: [identity('c', 1), identity('a', 1), identity('b', 0)],
    groups: [group('g2', 1), group('g1', 1), group('g0', 0)],
  })

  it('ordena por orden, nombre e id, con la identidad propia primera', () => {
    expect(orderedIdentities(data).map((i) => i.id)).toEqual(['b', 'a', 'c'])
    expect(orderedIdentities(data, 'c').map((i) => i.id)).toEqual(['c', 'b', 'a'])
    expect(orderedIdentities(data, 'b').map((i) => i.id)).toEqual(['b', 'a', 'c'])
    expect(orderedIdentities(data, 'nadie').map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })

  it('ordena los grupos por orden, nombre e id', () => {
    expect(orderedGroups(data).map((g) => g.id)).toEqual(['g0', 'g1', 'g2'])
  })
})

describe('boardIndex', () => {
  it('reúne identidades, grupos, servicios y destinos por id', () => {
    const data = dataOf({
      identities: [identity('ana')],
      groups: [group('g1')],
      accounts: [account('a1', 'ana', { serviceId: 'custom:s1' })],
      mode: 'multi',
    })
    const withService: LauncherData = {
      ...data,
      customServices: [
        {
          id: 's1',
          name: 'Intranet',
          urlTemplate: 'https://i.example/{email}',
          multiAccount: 'none',
          createdAt: AT,
          updatedAt: AT,
        },
      ],
    }
    const bindings: Bindings = { ana: { kind: 'chromium-profile', profileDirectory: 'Default' } }
    const index = boardIndex(withService, bindings, PROFILES)
    expect(index.identities.get('ana')?.id).toBe('ana')
    expect(index.groups.get('g1')?.id).toBe('g1')
    expect(index.services.get('github')?.name).toBe('GitHub')
    expect(index.services.get('custom:s1')?.name).toBe('Intranet')
    expect(index.services.get('custom:otro')).toBeUndefined()
    expect(index.destinations.get('a1')).toEqual({
      kind: 'profile',
      directory: 'Default',
      name: 'Trabajo',
      color: '#112233',
    })
    expect(index.identityDestinations.get('ana')).toEqual(index.destinations.get('a1'))
  })
})
