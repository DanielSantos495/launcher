import { createEmptyData, type Account, type CustomService, type LauncherData } from '@account-launcher/core'
import { describe, expect, it } from 'vitest'
import { httpBlockers } from '../../src/ui/lib/http-blockers'

const AT = '2026-10-01T10:00:00.000Z'

function account(id: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    identityId: 'ana',
    groupId: null,
    serviceId: 'generic',
    label: id,
    icon: { type: 'auto' },
    favorite: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  }
}

function service(id: string, urlTemplate: string): CustomService {
  return { id, name: id, urlTemplate, multiAccount: 'none', createdAt: AT, updatedAt: AT }
}

function dataOf(accounts: Account[], customServices: CustomService[]): LauncherData {
  const empty = createEmptyData()
  return {
    ...empty,
    identities: [{ id: 'ana', label: 'Ana', color: '#336699', order: 0, createdAt: AT, updatedAt: AT }],
    accounts,
    customServices,
    settings: { ...empty.settings, allowHttp: true },
  }
}

describe('httpBlockers', () => {
  it('lista la cuenta con dirección http y el servicio con plantilla http', () => {
    const data = dataOf(
      [account('intranet', { url: 'http://intranet.example/' })],
      [service('wiki', 'http://{username}.example/')],
    )
    const blockers = httpBlockers(data)
    expect(blockers.accounts.map((a) => a.id)).toEqual(['intranet'])
    expect(blockers.services.map((s) => s.id)).toEqual(['wiki'])
  })

  it('con todo en https las listas están vacías', () => {
    const data = dataOf(
      [account('web', { url: 'https://intranet.example/' }), account('github', { serviceId: 'github' })],
      [service('wiki', 'https://{username}.example/')],
    )
    expect(httpBlockers(data)).toEqual({ accounts: [], services: [] })
  })

  it('solo señala lo que usa http, no el resto', () => {
    const data = dataOf(
      [account('seguro', { url: 'https://a.example/' }), account('inseguro', { url: 'http://b.example/' })],
      [service('bueno', 'https://x.example/{email}'), service('malo', 'http://y.example/{email}')],
    )
    const blockers = httpBlockers(data)
    expect(blockers.accounts.map((a) => a.id)).toEqual(['inseguro'])
    expect(blockers.services.map((s) => s.id)).toEqual(['malo'])
  })

  it('una cuenta sin dirección propia no bloquea', () => {
    expect(httpBlockers(dataOf([account('sin-url', { serviceId: 'github' })], []))).toEqual({
      accounts: [],
      services: [],
    })
  })
})
