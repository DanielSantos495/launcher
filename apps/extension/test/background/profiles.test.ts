import { createEmptyData, type Identity } from '@account-launcher/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeHost, type FakeHost, type FakeHostOptions } from '../helpers/fake-host'
import { createTestEnv, type TestEnv } from '../helpers/env'

const AT = '2026-10-01T10:00:00.000Z'
const identity: Identity = { id: 'ana', label: 'Ana', color: '#336699', order: 0, createdAt: AT, updatedAt: AT }

const fakes: FakeHost[] = []

function setup(options: { host?: FakeHostOptions; mode?: 'single' | 'multi'; noHost?: boolean } = {}) {
  const fake = createFakeHost(options.host)
  fakes.push(fake)
  const base = createEmptyData()
  const t: TestEnv = createTestEnv({
    ...(options.noHost === true ? {} : { host: fake }),
    local: {
      localData: {
        ...base,
        revision: 1,
        identities: [identity],
        settings: { ...base.settings, mode: options.mode ?? 'multi' },
      },
    },
  })
  const sleep = vi.spyOn(t.deps, 'sleep')
  // Las pausas de profiles.create son de 500 ms; los plazos del cliente (10 s) también pasan por sleep.
  const pauses = () => sleep.mock.calls.filter(([ms]) => ms === 500).length
  return { t, fake, pauses }
}

afterEach(() => {
  for (const fake of fakes) expect(fake.invalidRequests).toBe(0)
  fakes.length = 0
})

const create = { type: 'profiles.create', identityId: 'ana', name: 'Trabajo' }

describe('profiles.list', () => {
  it('en Varios perfiles devuelve los perfiles del host', async () => {
    const { t, fake } = setup()
    expect(await t.route({ type: 'profiles.list' })).toEqual({ ok: true, result: { profiles: fake.state.profiles } })
    expect(fake.requests).toEqual([{ cmd: 'listProfiles', args: {} }])
  })

  it('en Perfil único es single_mode y no se llama al host', async () => {
    const { t, fake } = setup({ mode: 'single' })
    expect(await t.route({ type: 'profiles.list' })).toEqual({
      ok: false,
      error: { code: 'unavailable', hint: 'single_mode' },
    })
    expect(fake.requests).toHaveLength(0)
  })

  it('en un navegador sin host es unsupported_browser; con el host ausente, host_missing', async () => {
    expect(await setup({ noHost: true }).t.route({ type: 'profiles.list' })).toEqual({
      ok: false,
      error: { code: 'unavailable', hint: 'unsupported_browser' },
    })
    const missing = setup()
    missing.fake.mode = 'missing'
    expect(await missing.t.route({ type: 'profiles.list' })).toEqual({ ok: false, error: { code: 'host_missing' } })
  })
})

describe('profiles.create', () => {
  it('crea el perfil, espera a que aparezca y guarda el vínculo con el nombre pedido', async () => {
    const { t, fake, pauses } = setup()
    fake.createProfileVisibleAfter = 2
    const response = await t.route(create)
    expect(response).toEqual({
      ok: true,
      result: { directory: expect.stringMatching(/^Launcher-[0-9a-f]{8}$/) as string },
    })
    const directory = fake.state.profiles.at(-1)?.directory
    expect(await t.route({ type: 'bindings.get' })).toEqual({
      ok: true,
      result: { bindings: { ana: { kind: 'chromium-profile', profileDirectory: directory, desiredName: 'Trabajo' } } },
    })
    expect(pauses()).toBe(2)
    expect(fake.requests.map((r) => r.cmd)).toEqual(['createProfile', 'listProfiles', 'listProfiles'])
  })

  it('si el perfil no aparece en 20 intentos es profile_not_listed y no guarda ningún vínculo', async () => {
    const { t, fake, pauses } = setup()
    fake.createProfileVisibleAfter = Infinity
    expect(await t.route(create)).toEqual({ ok: false, error: { code: 'host_error', hint: 'profile_not_listed' } })
    expect(pauses()).toBe(20)
    expect(fake.requests.filter((r) => r.cmd === 'listProfiles')).toHaveLength(20)
    expect(await t.route({ type: 'bindings.get' })).toEqual({ ok: true, result: { bindings: {} } })
  })

  it('una identidad inexistente es not_found y no se llama al host', async () => {
    const { t, fake } = setup()
    expect(await t.route({ ...create, identityId: 'nadie' })).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(fake.requests).toHaveLength(0)
  })

  it('en Perfil único es single_mode y no se llama al host', async () => {
    const { t, fake } = setup({ mode: 'single' })
    expect(await t.route(create)).toEqual({ ok: false, error: { code: 'unavailable', hint: 'single_mode' } })
    expect(fake.requests).toHaveLength(0)
  })

  it('un error del host al crear o al listar se devuelve y no guarda el vínculo', async () => {
    const creating = setup()
    creating.fake.override = (r) =>
      r.cmd === 'createProfile' ? { ok: false, error: { code: 'launch_failed' } } : undefined
    expect(await creating.t.route(create)).toEqual({ ok: false, error: { code: 'launch_failed' } })
    const listing = setup()
    listing.fake.override = (r) => (r.cmd === 'listProfiles' ? { ok: false, error: { code: 'internal' } } : undefined)
    expect(await listing.t.route(create)).toEqual({ ok: false, error: { code: 'internal' } })
    expect(await listing.t.route({ type: 'bindings.get' })).toEqual({ ok: true, result: { bindings: {} } })
  })

  it('si la identidad se borra mientras se espera, no se guarda el vínculo: not_found', async () => {
    const { t, fake } = setup()
    fake.createProfileVisibleAfter = 2
    const pending = t.route(create)
    await t.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'identity.delete', id: 'ana' }] })
    expect(await pending).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(await t.route({ type: 'bindings.get' })).toEqual({ ok: true, result: { bindings: {} } })
  })
})

describe('host.ping', () => {
  it('en Varios perfiles devuelve el resultado de ping', async () => {
    const { t } = setup()
    expect(await t.route({ type: 'host.ping' })).toEqual({
      ok: true,
      result: { hostVersion: '0.1.0', protocol: 1, browser: 'brave', features: { temporaryContainer: true } },
    })
  })

  it('en Perfil único es single_mode y no se llama al host', async () => {
    const { t, fake } = setup({ mode: 'single' })
    expect(await t.route({ type: 'host.ping' })).toEqual({
      ok: false,
      error: { code: 'unavailable', hint: 'single_mode' },
    })
    expect(fake.requests).toHaveLength(0)
  })

  it('sin host es unsupported_browser y con el host ausente, host_missing', async () => {
    expect(await setup({ noHost: true }).t.route({ type: 'host.ping' })).toEqual({
      ok: false,
      error: { code: 'unavailable', hint: 'unsupported_browser' },
    })
    const missing = setup()
    missing.fake.mode = 'missing'
    expect(await missing.t.route({ type: 'host.ping' })).toEqual({ ok: false, error: { code: 'host_missing' } })
  })
})

describe('capabilities.get', () => {
  it('en Perfil único no llama al host', async () => {
    const { t, fake } = setup({ mode: 'single' })
    const response = await t.route({ type: 'capabilities.get' })
    expect(response).toMatchObject({ ok: true, result: { mode: 'single', host: { available: false } } })
    expect(fake.requests).toHaveLength(0)
  })

  it('en Varios perfiles pregunta al host y lo refleja', async () => {
    const { t, fake } = setup({ host: { browser: 'chrome' } })
    const response = await t.route({ type: 'capabilities.get' })
    expect(response).toMatchObject({
      ok: true,
      result: {
        mode: 'multi',
        host: { available: true, ping: { browser: 'chrome' } },
        providers: [
          { id: 'current', available: true },
          { id: 'chromium-profile', available: true },
          { id: 'brave-temporary-container', available: false, reason: 'unsupported_browser' },
        ],
      },
    })
    expect(fake.requests).toEqual([{ cmd: 'ping', args: {} }])
  })

  it('un host que no responde no bloquea la cola de escrituras', async () => {
    const { t, fake } = setup()
    fake.mode = 'hang'
    // Con el sleep del entorno, el plazo no vence nunca: la consulta queda pendiente fuera de la cola.
    const pending = t.route({ type: 'capabilities.get' })
    const read = await t.route({ type: 'data.get' })
    expect(read.ok).toBe(true)
    expect(await Promise.race([pending, Promise.resolve('pendiente')])).toBe('pendiente')
  })
})

describe('datos locales dañados', () => {
  it.each([
    ['capabilities.get', { type: 'capabilities.get' }],
    ['host.ping', { type: 'host.ping' }],
    ['profiles.list', { type: 'profiles.list' }],
    ['profiles.create', create],
    ['account.openTemporary', { type: 'account.openTemporary', target: { kind: 'url', url: 'https://example.com/' } }],
  ])('%s devuelve el error de lectura y no llama al host', async (_type, message) => {
    const fake = createFakeHost()
    fakes.push(fake)
    const t = createTestEnv({
      host: fake,
      local: {
        installation: { installationId: 'abc', paired: false, ownProfileDirectory: 'Profile 1' },
        localData: { ...createEmptyData(), schemaVersion: 2 },
      },
    })
    expect(await t.route(message)).toEqual({ ok: false, error: { code: 'internal', hint: 'local_data_newer' } })
    expect(fake.requests).toHaveLength(0)
  })
})
