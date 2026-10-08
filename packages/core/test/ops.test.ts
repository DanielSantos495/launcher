import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { applyOps, OpSchema } from '../src/ops'
import { LIMITS } from '../src/schema'
import { account, data, group, identity, T1 } from './fixtures'

describe('applyOps', () => {
  it('crea y reemplaza por id, y sube la revisión', () => {
    const d = data()
    const r = applyOps(d, [
      { type: 'identity.put', identity: identity({ id: 'id-home', label: 'Casa' }) },
      { type: 'identity.put', identity: identity({ label: 'Oficina' }) },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.identities.map((i) => i.label)).toEqual(['Oficina', 'Casa'])
    expect(r.value.revision).toBe(d.revision + 1)
  })

  it('no modifica los datos de entrada', () => {
    const d = data()
    const before = structuredClone(d)
    applyOps(d, [{ type: 'identity.put', identity: identity({ label: 'Otra' }) }])
    expect(d).toEqual(before)
  })

  it('sin operaciones devuelve los mismos datos', () => {
    const d = data()
    expect(applyOps(d, [])).toEqual({ ok: true, value: d })
  })

  it('no borra una identidad con cuentas', () => {
    const r = applyOps(data({ accounts: [account()] }), [{ type: 'identity.delete', id: 'id-work' }])
    expect(r).toEqual({ ok: false, error: { code: 'in_use', op: 0 } })
  })

  it('informa de la operación que falla', () => {
    const r = applyOps(data(), [
      { type: 'identity.put', identity: identity({ id: 'id-home' }) },
      { type: 'account.delete', id: 'no-existe' },
    ])
    expect(r).toEqual({ ok: false, error: { code: 'not_found', op: 1 } })
  })

  it('al borrar un grupo deja sus cuentas sin grupo', () => {
    const d = data({ groups: [group()], accounts: [account({ groupId: 'grp-dev' })] })
    const r = applyOps(d, [{ type: 'group.delete', id: 'grp-dev' }])
    expect(r.ok && r.value.accounts[0]?.groupId).toBeNull()
  })

  it('rechaza una cuenta con identidad desconocida', () => {
    const r = applyOps(data(), [{ type: 'account.put', account: account({ identityId: 'otra' }) }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid')
  })

  it('marca la última apertura', () => {
    const r = applyOps(data({ accounts: [account()] }), [{ type: 'account.touch', id: 'acc-github', at: T1 }])
    expect(r.ok && r.value.accounts[0]?.lastOpenedAt).toBe(T1)
  })

  it('no borra un servicio personalizado en uso', () => {
    const service = {
      id: 'slack',
      name: 'Slack',
      urlTemplate: 'https://{username}.slack.com/',
      multiAccount: 'parallel' as const,
      createdAt: T1,
      updatedAt: T1,
    }
    const d = data({
      customServices: [service],
      accounts: [account({ serviceId: 'custom:slack', username: 'acme' })],
    })
    expect(applyOps(d, [{ type: 'customService.delete', id: 'slack' }])).toEqual({
      ok: false,
      error: { code: 'in_use', op: 0 },
    })
  })

  it('cambia solo los ajustes indicados', () => {
    const r = applyOps(data(), [{ type: 'settings.set', settings: { mode: 'multi' } }])
    expect(r.ok && r.value.settings).toEqual({ ...data().settings, mode: 'multi' })
  })
})

describe('applyOps: casos adicionales', () => {
  const slack = {
    id: 'slack',
    name: 'Slack',
    urlTemplate: 'https://{username}.slack.com/',
    multiAccount: 'parallel' as const,
    createdAt: T1,
    updatedAt: T1,
  }

  it('sube la revisión a partir de la actual', () => {
    const r = applyOps(data({ revision: 7 }), [{ type: 'identity.put', identity: identity({ label: 'Otra' }) }])
    expect(r.ok && r.value.revision).toBe(8)
  })

  it('crea y reemplaza grupos por id', () => {
    const r = applyOps(data(), [
      { type: 'group.put', group: group() },
      { type: 'group.put', group: group({ name: 'Ocio' }) },
    ])
    expect(r.ok && r.value.groups.map((g) => g.name)).toEqual(['Ocio'])
  })

  it('crea, reemplaza y borra cuentas', () => {
    const created = applyOps(data(), [
      { type: 'account.put', account: account() },
      { type: 'account.put', account: account({ label: 'GitHub 2' }) },
    ])
    expect(created.ok && created.value.accounts.map((a) => a.label)).toEqual(['GitHub 2'])
    if (!created.ok) return
    const removed = applyOps(created.value, [{ type: 'account.delete', id: 'acc-github' }])
    expect(removed.ok && removed.value.accounts).toEqual([])
  })

  it('borra una identidad sin cuentas', () => {
    const r = applyOps(data(), [{ type: 'identity.delete', id: 'id-work' }])
    expect(r.ok && r.value.identities).toEqual([])
  })

  it('crea y borra un servicio personalizado sin uso', () => {
    const created = applyOps(data(), [{ type: 'customService.put', service: slack }])
    expect(created.ok && created.value.customServices).toEqual([slack])
    if (!created.ok) return
    const removed = applyOps(created.value, [{ type: 'customService.delete', id: 'slack' }])
    expect(removed.ok && removed.value.customServices).toEqual([])
  })

  it.each([
    [{ type: 'identity.delete', id: 'nadie' }],
    [{ type: 'group.delete', id: 'nadie' }],
    [{ type: 'account.touch', id: 'nadie', at: T1 }],
    [{ type: 'customService.delete', id: 'nadie' }],
  ] as const)('devuelve not_found si no existe el destino de %j', (op) => {
    expect(applyOps(data(), [op])).toEqual({ ok: false, error: { code: 'not_found', op: 0 } })
  })

  it('informa de invalid con la posición de la última operación y sin cambiar los datos', () => {
    const d = data()
    const before = structuredClone(d)
    const r = applyOps(d, [
      { type: 'identity.put', identity: identity({ id: 'id-home' }) },
      { type: 'account.put', account: account({ identityId: 'otra' }) },
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('invalid')
    expect(r.error.op).toBe(1)
    expect(r.error.issues).toEqual(['accounts.acc-github: identidad desconocida'])
    expect(d).toEqual(before)
  })

  it('rechaza un resultado que supera los límites del esquema', () => {
    const accounts = Array.from({ length: LIMITS.accounts }, (_, i) => account({ id: `acc-${String(i)}` }))
    const full = data({ accounts })
    expect(applyOps(full, [{ type: 'account.put', account: account({ id: 'acc-extra' }) }])).toMatchObject({
      ok: false,
      error: { code: 'invalid', op: 0 },
    })
    // Reemplazar una cuenta existente no cambia el total: sigue siendo válido.
    const replaced = applyOps(full, [{ type: 'account.put', account: account({ id: 'acc-0', label: 'Otra' }) }])
    expect(replaced.ok && replaced.value.accounts).toHaveLength(LIMITS.accounts)
  })

  it('rechaza una forma de campo que solo el esquema detecta', () => {
    const r = applyOps(data(), [{ type: 'identity.put', identity: identity({ id: 'id-home', label: '  ' }) }])
    expect(r).toEqual({ ok: false, error: { code: 'invalid', op: 0, issues: ['identities.1.label: check'] } })
  })

  it('un ajuste undefined conserva el valor actual', () => {
    const r = applyOps(data(), [{ type: 'settings.set', settings: { mode: undefined, allowHttp: true } }])
    expect(r.ok && r.value.settings).toEqual({ ...data().settings, allowHttp: true })
  })
})

describe('OpSchema', () => {
  it('rechaza tipos desconocidos y campos de más', () => {
    expect(v.safeParse(OpSchema, { type: 'identity.drop', id: 'x' }).success).toBe(false)
    expect(v.safeParse(OpSchema, { type: 'account.delete', id: 'x', extra: 1 }).success).toBe(false)
  })

  it('acepta una operación bien formada', () => {
    expect(v.safeParse(OpSchema, { type: 'account.touch', id: 'acc-github', at: T1 }).success).toBe(true)
    expect(v.safeParse(OpSchema, { type: 'settings.set', settings: {} }).success).toBe(true)
  })

  it('rechaza ids reservados, fechas no canónicas y ajustes desconocidos', () => {
    expect(v.safeParse(OpSchema, { type: 'account.delete', id: '__proto__' }).success).toBe(false)
    expect(v.safeParse(OpSchema, { type: 'account.touch', id: 'x', at: '2026-10-08T12:00:00Z' }).success).toBe(false)
    expect(v.safeParse(OpSchema, { type: 'settings.set', settings: { desconocido: true } }).success).toBe(false)
  })
})
