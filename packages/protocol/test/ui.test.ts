import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { UiRequestSchema } from '../src/ui'

describe('UiRequestSchema', () => {
  it.each([
    { type: 'account.open', accountId: 'acc-1' },
    { type: 'account.open', accountId: 'acc-1', asIdentityId: 'id-home' },
    { type: 'account.openTemporary', target: { kind: 'account', accountId: 'acc-1' } },
    { type: 'account.openTemporary', target: { kind: 'url', url: 'https://example.com/' }, name: 'Rápido' },
    { type: 'capabilities.get' },
    { type: 'profiles.create', identityId: 'id-home', name: 'Casa' },
    {
      type: 'data.mutate',
      revision: 3,
      ops: [{ type: 'account.touch', id: 'acc-1', at: '2026-10-07T12:00:00.000Z' }],
    },
    { type: 'bindings.set', identityId: 'id-home', binding: null },
    { type: 'pair.join', code: '042913' },
    { type: 'pair.declare', profileDirectory: 'Profile 1', identityId: 'id-home' },
    { type: 'sync.refresh' },
  ])('acepta %j', (request) => {
    expect(v.safeParse(UiRequestSchema, request).success).toBe(true)
  })

  it.each([
    { type: 'exec' },
    { type: 'capabilities.get', extra: true },
    { type: 'data.mutate', revision: 3, ops: [] },
    { type: 'account.openTemporary', target: { kind: 'url', url: 'https://example.com/' }, name: '-x' },
    { type: 'profiles.create', identityId: 'id-home', name: '   ' },
  ])('rechaza %j', (request) => {
    expect(v.safeParse(UiRequestSchema, request).success).toBe(false)
  })
})
