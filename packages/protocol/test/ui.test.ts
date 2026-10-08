import { createEmptyData, LIMITS } from '@account-launcher/core'
import * as v from 'valibot'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { UiRequestSchema, type UiRequestType, type UiResults } from '../src/ui'

// Un ejemplo válido por cada tipo de petición (son 18), más las variantes de los que tienen campos opcionales.
const accepted = [
  { type: 'account.open', accountId: 'acc-1' },
  { type: 'account.open', accountId: 'acc-1', asIdentityId: 'id-home' },
  { type: 'account.openTemporary', target: { kind: 'account', accountId: 'acc-1' } },
  { type: 'account.openTemporary', target: { kind: 'url', url: 'https://example.com/' }, name: 'Rápido' },
  { type: 'capabilities.get' },
  { type: 'profiles.list' },
  { type: 'profiles.create', identityId: 'id-home', name: 'Casa' },
  { type: 'host.ping' },
  { type: 'data.get' },
  {
    type: 'data.mutate',
    revision: 3,
    ops: [{ type: 'account.touch', id: 'acc-1', at: '2026-10-07T12:00:00.000Z' }],
  },
  { type: 'data.import', revision: 3, mode: 'replace', data: createEmptyData() },
  {
    type: 'data.import',
    revision: 3,
    mode: 'merge',
    data: createEmptyData(),
    bindingHints: [{ identityId: 'id-home', kind: 'chromium-profile', name: 'Casa' }],
  },
  { type: 'bindings.get' },
  { type: 'bindings.set', identityId: 'id-home', binding: null },
  { type: 'pair.start' },
  { type: 'pair.join', code: '042913' },
  { type: 'pair.declare', profileDirectory: 'Profile 1', identityId: 'id-home' },
  { type: 'pair.list' },
  { type: 'pair.remove', installationId: 'inst-b' },
  { type: 'pair.verify' },
  { type: 'sync.refresh' },
]

describe('UiRequestSchema', () => {
  it.each(accepted)('acepta %j', (request) => {
    expect(v.safeParse(UiRequestSchema, request).success).toBe(true)
  })

  it('hay un ejemplo aceptado por cada tipo de petición', () => {
    const types = UiRequestSchema.options.map((option) => option.entries.type.literal)
    expect(types).toHaveLength(18)
    expect([...new Set(accepted.map((request) => request.type))].sort()).toEqual([...types].sort())
  })

  it.each([
    { type: 'exec' },
    { type: 'capabilities.get', extra: true },
    { type: 'data.mutate', revision: 3, ops: [] },
    { type: 'account.openTemporary', target: { kind: 'url', url: 'https://example.com/' }, name: '-x' },
    { type: 'profiles.create', identityId: 'id-home', name: '   ' },
    { type: 'profiles.create', identityId: 'id-home', name: 'x'.repeat(LIMITS.label + 1) },
    { type: 'data.import', revision: 3, mode: 'otro', data: createEmptyData() },
    { type: 'data.import', revision: 3, mode: 'merge' },
    { type: 'data.import', revision: 3, mode: 'merge', data: { ...createEmptyData(), extra: 1 } },
    { type: 'data.import', revision: -1, mode: 'merge', data: createEmptyData() },
    {
      type: 'data.import',
      revision: 3,
      mode: 'merge',
      data: createEmptyData(),
      bindingHints: [{ identityId: '__proto__', kind: 'current' }],
    },
    {
      type: 'data.import',
      revision: 3,
      mode: 'merge',
      data: createEmptyData(),
      bindingHints: Array.from({ length: LIMITS.identities + 1 }, (_, n) => ({
        identityId: `id-${String(n)}`,
        kind: 'current',
      })),
    },
    { type: 'data.import', revision: 3, mode: 'merge', data: createEmptyData(), extra: true },
  ])('rechaza %j', (request) => {
    expect(v.safeParse(UiRequestSchema, request).success).toBe(false)
  })
})

describe('UiResults', () => {
  // Comprobación de tipos (la revisa `pnpm typecheck`): cada petición tiene su resultado y no sobra ninguno.
  it('tiene exactamente una entrada por cada tipo de petición', () => {
    expectTypeOf<keyof UiResults>().toEqualTypeOf<UiRequestType>()
  })
})

describe('UiResults de data.import', () => {
  it('devuelve la revisión, los recuentos de planImport y las identidades sin revincular', () => {
    expectTypeOf<UiResults['data.import']>().toEqualTypeOf<{
      readonly revision: number
      readonly added: number
      readonly updated: number
      readonly unchanged: number
      readonly removed: number
      readonly unresolved: readonly string[]
    }>()
  })
})
