import { createEmptyData, loadData, type Account, type Identity, type LauncherData } from '@account-launcher/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeHost, type FakeHost, type FakeHostOptions } from '../helpers/fake-host'
import { createTestEnv, DEFAULT_NOW, type TestEnv } from '../helpers/env'

const AT = '2026-10-01T10:00:00.000Z'

function identity(id: string, email?: string): Identity {
  const base = { id, label: id, color: '#336699', order: 0, createdAt: AT, updatedAt: AT }
  return email === undefined ? base : { ...base, email }
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

interface SetupOptions {
  readonly host?: FakeHostOptions
  readonly mode?: 'single' | 'multi'
  readonly allowHttp?: boolean
  readonly ownProfileDirectory?: string | undefined
  readonly accounts?: Account[]
  readonly customServices?: LauncherData['customServices']
  readonly noHost?: boolean
}

const fakes: FakeHost[] = []

// Dos identidades vinculadas (ana → Profile 1, bea → Default), una sin vínculo (cy) y la instalación con su
// perfil declarado. Por defecto, modo "Varios perfiles" y Brave.
function setup(options: SetupOptions = {}): { t: TestEnv; fake: FakeHost } {
  const fake = createFakeHost(options.host)
  fakes.push(fake)
  const base = createEmptyData()
  const data: LauncherData = {
    ...base,
    revision: 1,
    identities: [identity('ana', 'ana@example.com'), identity('bea'), identity('cy')],
    accounts: options.accounts ?? [
      account('gh', 'ana'),
      account('gh-cur', 'ana', { contextOverride: 'current' }),
      account('gh-cy', 'cy'),
    ],
    customServices: options.customServices ?? [],
    settings: { ...base.settings, mode: options.mode ?? 'multi', allowHttp: options.allowHttp ?? false },
  }
  const ownProfileDirectory = 'ownProfileDirectory' in options ? options.ownProfileDirectory : 'Profile 1'
  const t = createTestEnv({
    ...(options.noHost === true ? {} : { host: fake }),
    local: {
      installation: {
        installationId: 'abc',
        paired: false,
        ...(ownProfileDirectory === undefined ? {} : { ownProfileDirectory }),
      },
      localData: data,
      localBindings: {
        ana: { kind: 'chromium-profile', profileDirectory: 'Profile 1' },
        bea: { kind: 'chromium-profile', profileDirectory: 'Default' },
      },
    },
  })
  return { t, fake }
}

afterEach(() => {
  // Ninguna prueba debe haber hecho que el cliente envíe algo fuera del contrato.
  for (const fake of fakes) expect(fake.invalidRequests).toBe(0)
  fakes.length = 0
})

function lastOpenedAt(t: TestEnv, id: string): string | undefined {
  const stored = loadData(t.local.dump().localData)
  return stored.ok ? stored.value.accounts.find((a) => a.id === id)?.lastOpenedAt : undefined
}

describe('account.open con perfil de Chromium', () => {
  it('una identidad vinculada abre en su perfil mediante el host y marca lastOpenedAt', async () => {
    const { t, fake } = setup()
    const response = await t.route({ type: 'account.open', accountId: 'gh' })
    expect(response).toEqual({ ok: true, result: { provider: 'chromium-profile' } })
    expect(fake.state.launches).toEqual([{ cmd: 'open', profileDirectory: 'Profile 1', url: 'https://github.com/' }])
    expect(t.deps.opened).toEqual([])
    expect(lastOpenedAt(t, 'gh')).toBe(DEFAULT_NOW)
  })

  it('contextOverride current abre en el navegador actual; "Abrir como…" gana y abre en el perfil', async () => {
    const { t, fake } = setup()
    expect(await t.route({ type: 'account.open', accountId: 'gh-cur' })).toEqual({
      ok: true,
      result: { provider: 'current' },
    })
    expect(t.deps.opened).toEqual(['https://github.com/'])
    expect(fake.state.launches).toEqual([])
    expect(await t.route({ type: 'account.open', accountId: 'gh-cur', asIdentityId: 'bea' })).toEqual({
      ok: true,
      result: { provider: 'chromium-profile' },
    })
    expect(fake.state.launches).toEqual([{ cmd: 'open', profileDirectory: 'Default', url: 'https://github.com/' }])
    expect(t.deps.opened).toHaveLength(1)
  })

  it('una identidad sin vínculo abre en el navegador actual y no habla con el host', async () => {
    const { t, fake } = setup()
    expect(await t.route({ type: 'account.open', accountId: 'gh-cy' })).toEqual({
      ok: true,
      result: { provider: 'current' },
    })
    expect(t.deps.opened).toEqual(['https://github.com/'])
    expect(fake.requests).toHaveLength(0)
  })

  it('un vínculo a una carpeta que el host no conoce es unknown_profile y no marca lastOpenedAt', async () => {
    const { t, fake } = setup()
    await t.route({
      type: 'bindings.set',
      identityId: 'cy',
      binding: { kind: 'chromium-profile', profileDirectory: 'X' },
    })
    expect(await t.route({ type: 'account.open', accountId: 'gh-cy' })).toEqual({
      ok: false,
      error: { code: 'unknown_profile' },
    })
    expect(fake.state.launches).toEqual([])
    expect(t.deps.opened).toEqual([])
    expect(lastOpenedAt(t, 'gh-cy')).toBeUndefined()
  })

  it('con el host ausente es host_missing', async () => {
    const { t, fake } = setup()
    fake.mode = 'missing'
    expect(await t.route({ type: 'account.open', accountId: 'gh' })).toEqual({
      ok: false,
      error: { code: 'host_missing' },
    })
    expect(lastOpenedAt(t, 'gh')).toBeUndefined()
  })

  it('en un navegador sin host (no reconocido) es unavailable unsupported_browser', async () => {
    const { t } = setup({ noHost: true })
    expect(await t.route({ type: 'account.open', accountId: 'gh' })).toEqual({
      ok: false,
      error: { code: 'unavailable', hint: 'unsupported_browser' },
    })
    expect(t.deps.opened).toEqual([])
  })

  it('en Perfil único no se llama al host aunque haya vínculos', async () => {
    const { t, fake } = setup({ mode: 'single' })
    expect(await t.route({ type: 'account.open', accountId: 'gh' })).toEqual({
      ok: true,
      result: { provider: 'current' },
    })
    expect(fake.requests).toHaveLength(0)
  })
})

describe('toque de lastOpenedAt', () => {
  it('si la cuenta se borra mientras se abre, la apertura sigue siendo correcta', async () => {
    const { t } = setup()
    const openTab = t.deps.openTab
    vi.spyOn(t.deps, 'openTab').mockImplementation(async (opened) => {
      await openTab(opened)
      await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'account.delete', id: 'gh-cy' }] })
    })
    expect(await t.route({ type: 'account.open', accountId: 'gh-cy' })).toEqual({
      ok: true,
      result: { provider: 'current' },
    })
    expect(t.deps.opened).toEqual(['https://github.com/'])
  })
})

describe('account.openTemporary', () => {
  const url = (value: string) => ({ type: 'account.openTemporary', target: { kind: 'url', url: value } })

  it('en Perfil único es single_mode y no se llama al host', async () => {
    const { t, fake } = setup({ mode: 'single' })
    expect(await t.route(url('https://example.com/'))).toEqual({
      ok: false,
      error: { code: 'unavailable', hint: 'single_mode' },
    })
    expect(fake.requests).toHaveLength(0)
  })

  it('en un navegador sin host es unsupported_browser', async () => {
    const { t } = setup({ noHost: true })
    expect(await t.route(url('https://example.com/'))).toEqual({
      ok: false,
      error: { code: 'unavailable', hint: 'unsupported_browser' },
    })
  })

  it('sin perfil propio declarado es declare_profile', async () => {
    const { t, fake } = setup({ ownProfileDirectory: undefined })
    expect(await t.route(url('https://example.com/'))).toEqual({
      ok: false,
      error: { code: 'unavailable', hint: 'declare_profile' },
    })
    expect(fake.requests).toHaveLength(0)
  })

  it('abre una URL en el perfil propio y devuelve un objeto vacío', async () => {
    const { t, fake } = setup()
    expect(await t.route(url('https://example.com/'))).toEqual({ ok: true, result: {} })
    expect(fake.state.launches).toEqual([
      { cmd: 'openTemporary', profileDirectory: 'Profile 1', url: 'https://example.com/' },
    ])
  })

  it('una URL con esquema no permitido es url_scheme y no llega al host', async () => {
    const { t, fake } = setup()
    expect(await t.route(url('javascript:alert(1)'))).toEqual({
      ok: false,
      error: { code: 'invalid', hint: 'url_scheme' },
    })
    expect(fake.requests).toHaveLength(0)
  })

  it('la URL se normaliza antes de enviarla (espacios, mayúsculas, punycode)', async () => {
    const { t, fake } = setup()
    await t.route(url('  https://Ejemplo.com/a b  '))
    await t.route(url('https://café.example/'))
    expect(fake.state.launches.map((launch) => launch.url)).toEqual([
      'https://ejemplo.com/a%20b',
      'https://xn--caf-dma.example/',
    ])
  })

  it('http solo se admite con allowHttp', async () => {
    const strict = setup()
    expect(await strict.t.route(url('http://example.com/'))).toEqual({
      ok: false,
      error: { code: 'invalid', hint: 'url_scheme' },
    })
    const lax = setup({ allowHttp: true })
    expect(await lax.t.route(url('http://example.com/'))).toEqual({ ok: true, result: {} })
    expect(lax.fake.state.launches.map((launch) => launch.url)).toEqual(['http://example.com/'])
  })

  it('con nombre lo envía; sin nombre la clave no existe en la petición', async () => {
    const { t, fake } = setup()
    await t.route({ ...url('https://example.com/'), name: 'Banco' })
    expect(fake.requests.at(-1)?.args).toEqual({
      profileDirectory: 'Profile 1',
      url: 'https://example.com/',
      name: 'Banco',
    })
    await t.route(url('https://example.com/'))
    const args = fake.requests.at(-1)?.args ?? {}
    expect('name' in args).toBe(false)
    expect(fake.state.launches.at(-1)).toEqual({
      cmd: 'openTemporary',
      profileDirectory: 'Profile 1',
      url: 'https://example.com/',
    })
  })

  it('en Chrome es unsupported_browser; un nombre ya usado por un contenedor persistente es name_in_use', async () => {
    const chrome = setup({ host: { browser: 'chrome' } })
    expect(await chrome.t.route(url('https://example.com/'))).toEqual({
      ok: false,
      error: { code: 'unsupported_browser' },
    })
    const brave = setup({ host: { persistentContainers: { 'Profile 1': ['Trabajo'] } } })
    expect(await brave.t.route({ ...url('https://example.com/'), name: 'trabajo' })).toEqual({
      ok: false,
      error: { code: 'name_in_use' },
    })
    expect(brave.fake.state.launches).toEqual([])
  })

  it('con destino cuenta usa la URL de la cuenta y marca lastOpenedAt', async () => {
    const { t, fake } = setup()
    const response = await t.route({ type: 'account.openTemporary', target: { kind: 'account', accountId: 'gh-cy' } })
    expect(response).toEqual({ ok: true, result: {} })
    expect(fake.state.launches).toEqual([
      { cmd: 'openTemporary', profileDirectory: 'Profile 1', url: 'https://github.com/' },
    ])
    expect(lastOpenedAt(t, 'gh-cy')).toBe(DEFAULT_NOW)
  })

  it('con destino URL no se marca ninguna cuenta', async () => {
    const { t } = setup()
    await t.route(url('https://example.com/'))
    expect(lastOpenedAt(t, 'gh')).toBeUndefined()
    expect(lastOpenedAt(t, 'gh-cy')).toBeUndefined()
  })

  it('una cuenta inexistente es not_found', async () => {
    const { t, fake } = setup()
    const response = await t.route({ type: 'account.openTemporary', target: { kind: 'account', accountId: 'nada' } })
    expect(response).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(fake.requests).toHaveLength(0)
  })

  it('una cuenta sin URL calculable es url_no_url', async () => {
    const wiki = {
      id: 'wiki',
      name: 'Wiki',
      urlTemplate: 'https://wiki.example.com/{username}',
      multiAccount: 'none' as const,
      createdAt: AT,
      updatedAt: AT,
    }
    const { t, fake } = setup({
      accounts: [account('w', 'ana', { serviceId: 'custom:wiki' })],
      customServices: [wiki],
    })
    const response = await t.route({ type: 'account.openTemporary', target: { kind: 'account', accountId: 'w' } })
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'url_no_url' } })
    expect(fake.requests).toHaveLength(0)
  })

  it('un error del host con destino cuenta no marca lastOpenedAt', async () => {
    const { t } = setup({ host: { browser: 'chrome' } })
    await t.route({ type: 'account.openTemporary', target: { kind: 'account', accountId: 'gh-cy' } })
    expect(lastOpenedAt(t, 'gh-cy')).toBeUndefined()
  })
})
