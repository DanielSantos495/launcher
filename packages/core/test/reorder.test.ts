import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { applyOps, OpSchema } from '../src/ops'
import { LIMITS } from '../src/schema'
import { account, data, identity } from './fixtures'

const three = () =>
  data({
    identities: [
      identity({ id: 'i-a', label: 'A', order: 0 }),
      identity({ id: 'i-b', label: 'B', order: 1 }),
      identity({ id: 'i-c', label: 'C', order: 2 }),
    ],
    accounts: [
      account({ id: 'a1', identityId: 'i-a', order: 5 }),
      account({ id: 'a2', identityId: 'i-a', order: 7 }),
      account({ id: 'a3', identityId: 'i-a', order: 9 }),
      account({ id: 'z1', identityId: 'i-b', order: 3 }),
    ],
  })

describe('account.reorder', () => {
  it('reescribe order con el índice de la lista y deja intactas las demás cuentas', () => {
    const r = applyOps(three(), [{ type: 'account.reorder', ids: ['a3', 'a1', 'a2'] }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const orders = Object.fromEntries(r.value.accounts.map((a) => [a.id, a.order]))
    expect(orders).toEqual({ a3: 0, a1: 1, a2: 2, z1: 3 })
  })

  it('es determinista: repetir la misma lista da los mismos datos', () => {
    const once = applyOps(three(), [{ type: 'account.reorder', ids: ['a2', 'a3', 'a1'] }])
    if (!once.ok) throw new Error('falló')
    const twice = applyOps(once.value, [{ type: 'account.reorder', ids: ['a2', 'a3', 'a1'] }])
    if (!twice.ok) throw new Error('falló')
    expect(twice.value.accounts).toEqual(once.value.accounts)
  })

  it('falla con not_found si falta una cuenta y señala la operación', () => {
    const r = applyOps(three(), [{ type: 'account.reorder', ids: ['a1', 'nada'] }])
    expect(r).toEqual({ ok: false, error: { code: 'not_found', op: 0 } })
  })

  it('rechaza ids repetidos con invalid', () => {
    const r = applyOps(three(), [{ type: 'account.reorder', ids: ['a1', 'a1'] }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ code: 'invalid', op: 0 })
  })

  it('el esquema acota la lista (máximo y máximo + 1) y exige ids válidos', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `a${String(i)}`)
    expect(v.safeParse(OpSchema, { type: 'account.reorder', ids: ids(LIMITS.accounts) }).success).toBe(true)
    expect(v.safeParse(OpSchema, { type: 'account.reorder', ids: ids(LIMITS.accounts + 1) }).success).toBe(false)
    expect(v.safeParse(OpSchema, { type: 'account.reorder', ids: ['__proto__'] }).success).toBe(false)
    expect(v.safeParse(OpSchema, { type: 'account.reorder', ids: [], extra: 1 }).success).toBe(false)
  })
})

describe('identity.reorder', () => {
  it('reescribe order de las identidades indicadas', () => {
    const r = applyOps(three(), [{ type: 'identity.reorder', ids: ['i-c', 'i-a', 'i-b'] }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.fromEntries(r.value.identities.map((i) => [i.id, i.order]))).toEqual({ 'i-c': 0, 'i-a': 1, 'i-b': 2 })
  })

  it('falla con not_found si falta una identidad', () => {
    const r = applyOps(three(), [{ type: 'identity.reorder', ids: ['i-a', 'nada'] }])
    expect(r).toEqual({ ok: false, error: { code: 'not_found', op: 0 } })
  })

  it('el esquema acota la lista a las identidades máximas', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `i${String(i)}`)
    expect(v.safeParse(OpSchema, { type: 'identity.reorder', ids: ids(LIMITS.identities) }).success).toBe(true)
    expect(v.safeParse(OpSchema, { type: 'identity.reorder', ids: ids(LIMITS.identities + 1) }).success).toBe(false)
  })
})
