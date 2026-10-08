import { createEmptyData, type Account, type Group, type Identity, type LauncherData } from '../src/schema'

export const T0 = '2026-10-07T12:00:00.000Z'
export const T1 = '2026-10-08T12:00:00.000Z'

export function identity(over: Partial<Identity> = {}): Identity {
  return {
    id: 'id-work',
    label: 'Trabajo',
    email: 'ana@example.com',
    color: '#1f6feb',
    order: 0,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  }
}

export function group(over: Partial<Group> = {}): Group {
  return { id: 'grp-dev', name: 'Desarrollo', color: '#2da44e', order: 0, createdAt: T0, updatedAt: T0, ...over }
}

export function account(over: Partial<Account> = {}): Account {
  return {
    id: 'acc-github',
    identityId: 'id-work',
    groupId: null,
    serviceId: 'github',
    label: 'GitHub',
    icon: { type: 'bundled', name: 'github' },
    favorite: false,
    order: 0,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  }
}

export function data(over: Partial<LauncherData> = {}): LauncherData {
  return { ...createEmptyData(), identities: [identity()], ...over }
}
