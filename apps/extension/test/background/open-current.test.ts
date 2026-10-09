import type { Account, Identity, LauncherData } from '@account-launcher/core'
import { createEmptyData, loadData } from '@account-launcher/core'
import { describe, expect, it, vi } from 'vitest'
import { createTestEnv, type TestEnv } from '../helpers/env'
import { slowReads } from '../helpers/slow-reads'

const AT = '2026-10-01T10:00:00.000Z'
const TOUCHED = '2026-10-08T12:00:00.000Z'

function identity(id: string, email?: string): Identity {
  const base = { id, label: id, color: '#336699', order: 0, createdAt: AT, updatedAt: AT }
  return email === undefined ? base : { ...base, email }
}

function account(id: string, identityId: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    identityId,
    groupId: null,
    serviceId: 'google.gmail',
    label: id,
    icon: { type: 'auto' },
    favorite: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  }
}

function seed(data: Partial<LauncherData>, bindings: Record<string, unknown> = {}) {
  return { localData: { ...createEmptyData(), revision: 1, ...data }, localBindings: bindings }
}

function storedAccount(t: TestEnv, id: string): Account | undefined {
  const stored = loadData(t.local.dump().localData)
  return stored.ok ? stored.value.accounts.find((a) => a.id === id) : undefined
}

describe('account.open en el navegador actual', () => {
  it('abre Gmail con el email de la identidad, devuelve current y marca lastOpenedAt', async () => {
    const t = createTestEnv({
      local: seed({ identities: [identity('ana', 'ana@example.com')], accounts: [account('mail', 'ana')] }),
    })
    const response = await t.route({ type: 'account.open', accountId: 'mail' })
    expect(response).toEqual({ ok: true, result: { provider: 'current' } })
    expect(t.deps.opened).toEqual(['https://mail.google.com/mail/?authuser=ana%40example.com'])
    expect(storedAccount(t, 'mail')?.lastOpenedAt).toBe(TOUCHED)
  })

  it('dos Gmail de identidades distintas abren cada uno su authuser', async () => {
    const t = createTestEnv({
      local: seed({
        identities: [identity('ana', 'ana@example.com'), identity('bea', 'bea@example.com')],
        accounts: [account('mail-a', 'ana'), account('mail-b', 'bea')],
      }),
    })
    await t.route({ type: 'account.open', accountId: 'mail-a' })
    await t.route({ type: 'account.open', accountId: 'mail-b' })
    expect(t.deps.opened).toEqual([
      'https://mail.google.com/mail/?authuser=ana%40example.com',
      'https://mail.google.com/mail/?authuser=bea%40example.com',
    ])
  })

  it('una cuenta inexistente es not_found y no abre nada', async () => {
    const t = createTestEnv({ local: seed({ identities: [identity('ana')], accounts: [account('mail', 'ana')] }) })
    const response = await t.route({ type: 'account.open', accountId: 'fantasma' })
    expect(response).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(t.deps.opened).toEqual([])
  })

  it('un asIdentityId inexistente es not_found y no abre nada', async () => {
    const t = createTestEnv({ local: seed({ identities: [identity('ana')], accounts: [account('mail', 'ana')] }) })
    const response = await t.route({ type: 'account.open', accountId: 'mail', asIdentityId: 'fantasma' })
    expect(response).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(t.deps.opened).toEqual([])
  })

  it('en multi, asIdentityId decide el destino en lugar de la identidad de la cuenta', async () => {
    const multi = { ...createEmptyData().settings, mode: 'multi' as const }
    const t = createTestEnv({
      local: {
        localData: {
          ...createEmptyData(),
          identities: [identity('ana', 'ana@example.com'), identity('bea')],
          accounts: [account('mail', 'ana')],
          settings: multi,
        },
        localBindings: { bea: { kind: 'chromium-profile', profileDirectory: 'Profile 2' } },
      },
    })
    const own = await t.route({ type: 'account.open', accountId: 'mail' })
    expect(own).toEqual({ ok: true, result: { provider: 'current' } })
    expect(t.deps.opened).toHaveLength(1)
    const viaBea = await t.route({ type: 'account.open', accountId: 'mail', asIdentityId: 'bea' })
    expect(viaBea).toEqual({ ok: false, error: { code: 'unavailable', hint: 'not_implemented' } })
    expect(t.deps.opened).toHaveLength(1)
  })

  it('una cuenta sin URL calculable es invalid url_no_url y no abre nada', async () => {
    const t = createTestEnv({
      local: seed({
        identities: [identity('ana')],
        customServices: [
          {
            id: 'wiki',
            name: 'Wiki',
            urlTemplate: 'https://wiki.example.com/{username}',
            multiAccount: 'none',
            createdAt: AT,
            updatedAt: AT,
          },
        ],
        accounts: [account('w', 'ana', { serviceId: 'custom:wiki' })],
      }),
    })
    const response = await t.route({ type: 'account.open', accountId: 'w' })
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'url_no_url' } })
    expect(t.deps.opened).toEqual([])
  })

  it('si openTab rechaza devuelve open_failed y no marca lastOpenedAt', async () => {
    const t = createTestEnv({
      local: seed({ identities: [identity('ana', 'ana@example.com')], accounts: [account('mail', 'ana')] }),
    })
    vi.spyOn(t.deps, 'openTab').mockRejectedValue(new Error('no se pudo /Users/ana'))
    const response = await t.route({ type: 'account.open', accountId: 'mail' })
    expect(response).toEqual({ ok: false, error: { code: 'internal', hint: 'open_failed' } })
    expect(storedAccount(t, 'mail')?.lastOpenedAt).toBeUndefined()
  })

  it('si falla el toque, la apertura sigue siendo correcta', async () => {
    const t = createTestEnv({
      local: seed({ identities: [identity('ana', 'ana@example.com')], accounts: [account('mail', 'ana')] }),
    })
    // La instalación ya existe: el único set que queda es el del toque.
    await t.route({ type: 'data.get' })
    t.local.failNextSet()
    const response = await t.route({ type: 'account.open', accountId: 'mail' })
    expect(response).toEqual({ ok: true, result: { provider: 'current' } })
    expect(t.deps.opened).toHaveLength(1)
    expect(storedAccount(t, 'mail')?.lastOpenedAt).toBeUndefined()
  })

  it('un error de lectura en el toque tampoco cambia el resultado', async () => {
    const t = createTestEnv({
      local: seed({ identities: [identity('ana', 'ana@example.com')], accounts: [account('mail', 'ana')] }),
    })
    const openTab = t.deps.openTab
    vi.spyOn(t.deps, 'openTab').mockImplementation(async (url) => {
      await openTab(url)
      // Tras abrir, el almacenamiento deja de responder: el toque falla con una excepción.
      vi.spyOn(t.local, 'get').mockRejectedValue(new Error('boom'))
    })
    const response = await t.route({ type: 'account.open', accountId: 'mail' })
    expect(response).toEqual({ ok: true, result: { provider: 'current' } })
    expect(t.deps.opened).toHaveLength(1)
  })

  it('abrir y leer a la vez en una instalación nueva crean una sola instalación', async () => {
    const t = createTestEnv()
    slowReads(t.local)
    await Promise.all([t.route({ type: 'account.open', accountId: 'nada' }), t.route({ type: 'data.get' })])
    expect(t.local.dump().installation).toEqual({ installationId: 'id-1', paired: false })
    expect(t.deps.randomId()).toBe('id-2')
  })

  it('el toque de lastOpenedAt se serializa con las demás escrituras y no pierde ninguna', async () => {
    const t = createTestEnv({
      local: {
        installation: { installationId: 'abc', paired: false },
        ...seed({ identities: [identity('ana', 'ana@example.com')], accounts: [account('mail', 'ana')] }),
      },
    })
    // La primera escritura (la de data.mutate) queda retenida hasta que se suelta.
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const set = t.local.set.bind(t.local)
    let held = false
    vi.spyOn(t.local, 'set').mockImplementation(async (items) => {
      if (!held) {
        held = true
        await gate
      }
      await set(items)
    })
    const opening = t.route({ type: 'account.open', accountId: 'mail' })
    const mutating = t.route({
      type: 'data.mutate',
      revision: 0,
      ops: [{ type: 'identity.put', identity: identity('bea') }],
    })
    // Deja que la apertura llegue al toque mientras la escritura de data.mutate sigue retenida.
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    expect(await opening).toEqual({ ok: true, result: { provider: 'current' } })
    expect(await mutating).toEqual({ ok: true, result: { revision: 2 } })
    const stored = loadData(t.local.dump().localData)
    expect(stored.ok && stored.value.identities.map((i) => i.id)).toEqual(['ana', 'bea'])
    expect(storedAccount(t, 'mail')?.lastOpenedAt).toBe(TOUCHED)
  })

  it('en multi, una identidad con vínculo chromium-profile aún no está implementada', async () => {
    const t = createTestEnv({
      local: {
        localData: {
          ...createEmptyData(),
          identities: [identity('ana', 'ana@example.com')],
          accounts: [account('mail', 'ana')],
          settings: { ...createEmptyData().settings, mode: 'multi' },
        },
        localBindings: { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } },
      },
    })
    const response = await t.route({ type: 'account.open', accountId: 'mail' })
    expect(response).toEqual({ ok: false, error: { code: 'unavailable', hint: 'not_implemented' } })
    expect(t.deps.opened).toEqual([])
  })

  it('en single se ignoran los vínculos', async () => {
    const t = createTestEnv({
      local: seed(
        { identities: [identity('ana', 'ana@example.com')], accounts: [account('mail', 'ana')] },
        { ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1' } },
      ),
    })
    const response = await t.route({ type: 'account.open', accountId: 'mail' })
    expect(response).toEqual({ ok: true, result: { provider: 'current' } })
    expect(t.deps.opened).toHaveLength(1)
  })
})
