import type { LauncherData } from '@account-launcher/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestEnv, DEFAULT_NOW, EXTENSION_ID, LAUNCHER_URL, type TestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost } from '../helpers/fake-host'
import {
  AT,
  dataWith,
  pairedLocal,
  registerInstallation,
  requestsOf,
  TOKEN_A,
  TOKEN_C,
  unpairedLocal,
} from '../helpers/shared-setup'

const WHOAMI_URL = `chrome-extension://${EXTENSION_ID}/whoami.html`
const CODE = { code: expect.stringMatching(/^\d{6}$/) as unknown, expiresAt: expect.any(String) as unknown }

let fake: FakeHost

afterEach(() => {
  // Ninguna instalación puede enviar al host una petición fuera del contrato.
  expect(fake.invalidRequests).toBe(0)
})

function installation(t: TestEnv): unknown {
  return t.local.dump().installation
}

function tokenOf(t: TestEnv): string {
  const stored = t.local.dump().pairing
  if (typeof stored !== 'object' || stored === null || !('token' in stored) || typeof stored.token !== 'string') {
    throw new Error('la instalación no tiene token')
  }
  return stored.token
}

// Instalaciones A, B y C con almacenamiento propio y el mismo host falso, todas en "Varios perfiles".
function installations(): { a: TestEnv; b: TestEnv; c: TestEnv } {
  fake = createFakeHost()
  const make = (id: string, identity: string) =>
    createTestEnv({ host: fake, local: unpairedLocal(id, dataWith('multi', [identity])) })
  return { a: make('inst-a', 'ana'), b: make('inst-b', 'bea'), c: make('inst-c', 'cris') }
}

async function paired(): Promise<{ a: TestEnv; b: TestEnv; c: TestEnv }> {
  const { a, b, c } = installations()
  const started = await a.route({ type: 'pair.start' })
  if (!started.ok) throw new Error('pair.start de A falló')
  const { code } = started.result as { code: string }
  expect(await b.route({ type: 'pair.join', code })).toEqual({ ok: true, result: {} })
  return { a, b, c }
}

function account(identityId: string) {
  return {
    id: 'acc-a',
    identityId,
    groupId: null,
    serviceId: 'github',
    label: 'GitHub',
    icon: { type: 'auto' },
    favorite: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  }
}

describe('emparejamiento', () => {
  it('A pair.start devuelve código y caducidad, queda emparejada y siembra el almacén con sus datos', async () => {
    const { a } = installations()
    const response = await a.route({ type: 'pair.start' })
    expect(response).toEqual({ ok: true, result: CODE })
    expect(Object.keys((response as { result: object }).result)).toEqual(['code', 'expiresAt'])
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: true })
    // El token está en storage.local (clave pairing), nunca en la respuesta.
    expect(JSON.stringify(response)).not.toContain(tokenOf(a))
    expect(fake.state.store).toEqual({ revision: 1, data: dataWith('multi', ['ana']), bindings: {} })
  })

  it('B pair.join con el código devuelve {} y B lee los datos de A con su propio modo', async () => {
    const { a, b } = installations()
    const started = await a.route({ type: 'pair.start' })
    const code = started.ok ? (started.result as { code: string }).code : ''
    expect(await b.route({ type: 'pair.join', code })).toEqual({ ok: true, result: {} })
    expect(installation(b)).toEqual({ installationId: 'inst-b', paired: true })
    expect(await b.route({ type: 'data.get' })).toEqual({
      ok: true,
      result: { data: dataWith('multi', ['ana']), source: 'shared' },
    })
  })

  it('un cambio de A aparece en B tras sync.refresh', async () => {
    const { a, b } = await paired()
    await b.route({ type: 'data.get' }) // B ya tiene la caché de la revisión 1
    const mutated = await a.route({
      type: 'data.mutate',
      revision: 0,
      ops: [{ type: 'account.put', account: account('ana') }],
    })
    expect(mutated).toEqual({ ok: true, result: { revision: 2 } })
    // Sin refresh, B sigue viendo su caché.
    expect(await b.route({ type: 'data.get' })).toMatchObject({ ok: true, result: { data: { accounts: [] } } })
    expect(await b.route({ type: 'sync.refresh' })).toEqual({ ok: true, result: { revision: 2 } })
    const got = await b.route({ type: 'data.get' })
    expect(got).toMatchObject({ ok: true, result: { source: 'shared' } })
    expect((got as { result: { data: LauncherData } }).result.data.accounts.map((x) => x.id)).toEqual(['acc-a'])
  })

  it('con el máximo de perfiles emparejado, pair.start responde limit_reached y no emite código', async () => {
    const { a } = await paired()
    const before = requestsOf(fake, 'pair.start')
    expect(await a.route({ type: 'pair.start' })).toEqual({ ok: false, error: { code: 'limit_reached' } })
    expect(requestsOf(fake, 'pair.start')).toBe(before + 1)
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: true })
  })

  it('un segundo pair.start con token da un código nuevo sin token y, si el máximo se llena antes, pair.join es limit_reached', async () => {
    const { a, c } = installations()
    expect(await a.route({ type: 'pair.start' })).toEqual({ ok: true, result: CODE })
    const again = await a.route({ type: 'pair.start' })
    expect(again).toEqual({ ok: true, result: CODE })
    expect(Object.keys((again as { result: object }).result)).toEqual(['code', 'expiresAt'])
    const code = again.ok ? (again.result as { code: string }).code : ''
    // Otro perfil llena el máximo antes de que C use el código.
    registerInstallation(fake, 'inst-x', TOKEN_C)
    expect(await c.route({ type: 'pair.join', code })).toEqual({ ok: false, error: { code: 'limit_reached' } })
    expect(installation(c)).toEqual({ installationId: 'inst-c', paired: false })
    expect(Object.keys(c.local.dump())).not.toContain('pairing')
  })

  it('una instalación sin emparejar usa solo lo local y no llama al host', async () => {
    const { c } = await paired()
    const before = fake.requests.length
    expect(await c.route({ type: 'sync.refresh' })).toEqual({ ok: true, result: { revision: 1 } })
    expect(await c.route({ type: 'data.get' })).toMatchObject({ ok: true, result: { source: 'local' } })
    expect(fake.requests.length).toBe(before)
  })

  it('un token falsificado de formato válido es not_paired y deja la instalación sin emparejar', async () => {
    const { a } = await paired()
    const forged = createTestEnv({ host: fake, local: pairedLocal('inst-c', TOKEN_C, dataWith('multi', ['cris'])) })
    expect(await forged.route({ type: 'data.get' })).toEqual({ ok: false, error: { code: 'not_paired' } })
    expect(installation(forged)).toEqual({ installationId: 'inst-c', paired: false })
    expect(Object.keys(forged.local.dump())).not.toContain('pairing')
    const before = fake.requests.length
    expect(await forged.route({ type: 'data.get' })).toMatchObject({ ok: true, result: { source: 'local' } })
    expect(fake.requests.length).toBe(before)
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: true })
  })

  it('B pair.join con un código incorrecto es bad_code y A pair.join es already_paired', async () => {
    const { a, b } = installations()
    await a.route({ type: 'pair.start' })
    expect(await b.route({ type: 'pair.join', code: '000000' })).toEqual({ ok: false, error: { code: 'bad_code' } })
    expect(installation(b)).toEqual({ installationId: 'inst-b', paired: false })
    expect(Object.keys(b.local.dump())).not.toContain('pairing')
    const before = fake.requests.length
    expect(await a.route({ type: 'pair.join', code: '123456' })).toEqual({
      ok: false,
      error: { code: 'invalid', hint: 'already_paired' },
    })
    expect(fake.requests.length).toBe(before)
  })

  it('pair.start sin token con el almacén ya creado es not_paired y no empareja (DC13)', async () => {
    const { c } = await paired()
    expect(await c.route({ type: 'pair.start' })).toEqual({ ok: false, error: { code: 'not_paired' } })
    expect(installation(c)).toEqual({ installationId: 'inst-c', paired: false })
  })

  it('si el host no devuelve token en el primer pair.start, es bad_response y no se guarda nada', async () => {
    const { a } = installations()
    fake.override = ({ cmd }) =>
      cmd === 'pair.start' ? { ok: true, result: { code: '123456', expiresAt: DEFAULT_NOW } } : undefined
    expect(await a.route({ type: 'pair.start' })).toEqual({
      ok: false,
      error: { code: 'host_error', hint: 'bad_response' },
    })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: false })
    expect(Object.keys(a.local.dump())).not.toContain('pairing')
  })

  it('un fallo al sembrar no cambia el resultado de pair.start', async () => {
    const { a } = installations()
    fake.override = ({ cmd }) => (cmd === 'sync.put' ? { ok: false, error: { code: 'internal' } } : undefined)
    expect(await a.route({ type: 'pair.start' })).toEqual({ ok: true, result: CODE })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: true })
  })

  it('un fallo al leer lo compartido tras pair.join no cambia su resultado y se ve en data.get', async () => {
    const { a, b } = installations()
    const started = await a.route({ type: 'pair.start' })
    const code = started.ok ? (started.result as { code: string }).code : ''
    if (fake.state.store !== undefined) fake.state.store.data = { ...dataWith('multi'), schemaVersion: 2 }
    expect(await b.route({ type: 'pair.join', code })).toEqual({ ok: true, result: {} })
    expect(installation(b)).toEqual({ installationId: 'inst-b', paired: true })
    expect(await b.route({ type: 'data.get' })).toEqual({
      ok: false,
      error: { code: 'invalid', hint: 'shared_data_newer' },
    })
  })

  it('un pair.start con token revocado es not_paired y borra el emparejamiento', async () => {
    const { a } = await paired()
    fake.state.installations.splice(0)
    expect(await a.route({ type: 'pair.start' })).toEqual({ ok: false, error: { code: 'not_paired' } })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: false })
    expect(Object.keys(a.local.dump())).not.toContain('pairing')
  })
})

describe('pair.list y pair.remove', () => {
  it('sin token son not_paired y no llaman al host', async () => {
    const { a } = installations()
    expect(await a.route({ type: 'pair.list' })).toEqual({ ok: false, error: { code: 'not_paired' } })
    expect(await a.route({ type: 'pair.remove', installationId: 'inst-b' })).toEqual({
      ok: false,
      error: { code: 'not_paired' },
    })
    expect(fake.requests).toEqual([])
  })

  it('pair.list devuelve el resultado del host', async () => {
    const { a } = await paired()
    const response = await a.route({ type: 'pair.list' })
    expect(response).toEqual({
      ok: true,
      result: {
        maxPairedProfiles: 2,
        installations: [
          { installationId: 'inst-a', pairedAt: DEFAULT_NOW, self: true },
          { installationId: 'inst-b', pairedAt: DEFAULT_NOW, self: false },
        ],
      },
    })
  })

  it('A pair.remove de B: B recibe not_paired en su siguiente sync.refresh y queda sin emparejar', async () => {
    const { a, b } = await paired()
    expect(await a.route({ type: 'pair.remove', installationId: 'inst-b' })).toEqual({ ok: true, result: {} })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: true })
    expect(await b.route({ type: 'sync.refresh' })).toEqual({ ok: false, error: { code: 'not_paired' } })
    expect(installation(b)).toEqual({ installationId: 'inst-b', paired: false })
    expect(Object.keys(b.local.dump())).not.toContain('pairing')
  })

  it('pair.remove de la propia instalación la deja sin emparejar y en origen local', async () => {
    const { a } = await paired()
    expect(await a.route({ type: 'pair.remove', installationId: 'inst-a' })).toEqual({ ok: true, result: {} })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: false })
    expect(Object.keys(a.local.dump())).not.toContain('pairing')
    expect(Object.keys(a.session.dump())).not.toContain('shared')
    expect(await a.route({ type: 'data.get' })).toMatchObject({ ok: true, result: { source: 'local' } })
  })

  it('un error del host en pair.remove se devuelve y no desempareja', async () => {
    const { a } = await paired()
    expect(await a.route({ type: 'pair.remove', installationId: 'otra' })).toEqual({
      ok: false,
      error: { code: 'not_found' },
    })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: true })
  })

  it('con el token revocado, pair.list y pair.remove son not_paired y borran el emparejamiento', async () => {
    const { a, b } = await paired()
    fake.state.installations.splice(0)
    expect(await a.route({ type: 'pair.list' })).toEqual({ ok: false, error: { code: 'not_paired' } })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: false })
    expect(await b.route({ type: 'pair.remove', installationId: 'inst-a' })).toEqual({
      ok: false,
      error: { code: 'not_paired' },
    })
    expect(installation(b)).toEqual({ installationId: 'inst-b', paired: false })
  })
})

describe('pair.declare', () => {
  it('guarda el perfil y la identidad, y el host los recibe', async () => {
    const { a } = await paired()
    const response = await a.route({ type: 'pair.declare', profileDirectory: 'Default', identityId: 'ana' })
    expect(response).toEqual({ ok: true, result: {} })
    expect(installation(a)).toEqual({
      installationId: 'inst-a',
      paired: true,
      ownProfileDirectory: 'Default',
      ownIdentityId: 'ana',
    })
    expect(requestsOf(fake, 'pair.declare')).toBe(1)
    expect(fake.state.installations[0]).toMatchObject({ profileDirectory: 'Default', identityId: 'ana' })
  })

  it('sin identityId quita la identidad ya declarada', async () => {
    const { a } = await paired()
    await a.route({ type: 'pair.declare', profileDirectory: 'Default', identityId: 'ana' })
    expect(await a.route({ type: 'pair.declare', profileDirectory: 'Profile 1' })).toEqual({ ok: true, result: {} })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: true, ownProfileDirectory: 'Profile 1' })
    expect(fake.state.installations[0]?.identityId).toBeUndefined()
  })

  it('una identidad inexistente es not_found y no guarda nada ni llama al host', async () => {
    const { a } = await paired()
    const before = fake.requests.length
    expect(await a.route({ type: 'pair.declare', profileDirectory: 'Default', identityId: 'fantasma' })).toEqual({
      ok: false,
      error: { code: 'not_found' },
    })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: true })
    expect(fake.requests.length).toBe(before)
  })

  it('un error del host se devuelve sin guardar', async () => {
    const { a } = await paired()
    fake.override = ({ cmd }) => (cmd === 'pair.declare' ? { ok: false, error: { code: 'not_found' } } : undefined)
    expect(await a.route({ type: 'pair.declare', profileDirectory: 'Default' })).toEqual({
      ok: false,
      error: { code: 'not_found' },
    })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: true })
  })

  it('con el token revocado es not_paired y borra el emparejamiento', async () => {
    const { a } = await paired()
    fake.state.installations.splice(0)
    expect(await a.route({ type: 'pair.declare', profileDirectory: 'Default' })).toEqual({
      ok: false,
      error: { code: 'not_paired' },
    })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: false })
  })

  it('sin token solo guarda en local', async () => {
    const { c } = installations()
    expect(await c.route({ type: 'pair.declare', profileDirectory: 'Default', identityId: 'cris' })).toEqual({
      ok: true,
      result: {},
    })
    expect(installation(c)).toEqual({
      installationId: 'inst-c',
      paired: false,
      ownProfileDirectory: 'Default',
      ownIdentityId: 'cris',
    })
    expect(fake.requests).toEqual([])
    // También allí una identidad inexistente es not_found.
    expect(await c.route({ type: 'pair.declare', profileDirectory: 'Default', identityId: 'fantasma' })).toEqual({
      ok: false,
      error: { code: 'not_found' },
    })
  })
})

describe('perfil declarado antes de emparejar', () => {
  // Código de emparejamiento nuevo de A.
  async function codeOf(t: TestEnv): Promise<string> {
    const started = await t.route({ type: 'pair.start' })
    if (!started.ok) throw new Error('pair.start falló')
    return (started.result as { code: string }).code
  }

  function hostEntry(installationId: string) {
    return fake.state.installations.find((entry) => entry.installationId === installationId)
  }

  it('B declara una identidad propia y se une: el host recibe la carpeta sin la identidad y pair.verify funciona', async () => {
    const { a, b } = installations()
    // Sin token solo se guarda en local; la identidad de B no existe en la lista de A.
    expect(await b.route({ type: 'pair.declare', profileDirectory: 'Profile 1', identityId: 'bea' })).toEqual({
      ok: true,
      result: {},
    })
    expect(requestsOf(fake, 'pair.declare')).toBe(0)
    expect(await b.route({ type: 'pair.join', code: await codeOf(a) })).toEqual({ ok: true, result: {} })

    expect(requestsOf(fake, 'pair.declare')).toBe(1)
    expect(hostEntry('inst-b')?.profileDirectory).toBe('Profile 1')
    expect(hostEntry('inst-b')?.identityId).toBeUndefined()
    // La instalación tampoco conserva una identidad que no está en la lista compartida.
    expect(installation(b)).toEqual({ installationId: 'inst-b', paired: true, ownProfileDirectory: 'Profile 1' })

    fake.onVerify = (nonce) => {
      void b.route({ type: 'whoami.prove', nonce }, `${WHOAMI_URL}#${nonce}`)
    }
    expect(await b.route({ type: 'pair.verify' })).toEqual({
      ok: true,
      result: { expiresAt: expect.any(String) as unknown },
    })
    const listed = await b.route({ type: 'pair.list' })
    const entries = listed.ok
      ? (listed.result as { installations: { self: boolean; verifiedAt?: string }[] }).installations
      : []
    expect(entries.find((entry) => entry.self)?.verifiedAt).toBe(DEFAULT_NOW)
  })

  it('con una identidad que sí existe en la lista compartida, el host la recibe (A al activar y B al unirse)', async () => {
    fake = createFakeHost()
    const make = (id: string) => createTestEnv({ host: fake, local: unpairedLocal(id, dataWith('multi', ['ana'])) })
    const a = make('inst-a')
    const b = make('inst-b')
    await a.route({ type: 'pair.declare', profileDirectory: 'Default', identityId: 'ana' })
    await b.route({ type: 'pair.declare', profileDirectory: 'Profile 1', identityId: 'ana' })

    // A siembra el almacén con sus datos: 'ana' ya está en la lista compartida.
    const code = await codeOf(a)
    expect(hostEntry('inst-a')).toMatchObject({ profileDirectory: 'Default', identityId: 'ana' })
    expect(installation(a)).toEqual({
      installationId: 'inst-a',
      paired: true,
      ownProfileDirectory: 'Default',
      ownIdentityId: 'ana',
    })

    expect(await b.route({ type: 'pair.join', code })).toEqual({ ok: true, result: {} })
    expect(hostEntry('inst-b')).toMatchObject({ profileDirectory: 'Profile 1', identityId: 'ana' })
    expect(installation(b)).toEqual({
      installationId: 'inst-b',
      paired: true,
      ownProfileDirectory: 'Profile 1',
      ownIdentityId: 'ana',
    })
  })

  it('sin perfil declarado no se llama a pair.declare', async () => {
    const { a, b } = installations()
    expect(await b.route({ type: 'pair.join', code: await codeOf(a) })).toEqual({ ok: true, result: {} })
    expect(requestsOf(fake, 'pair.declare')).toBe(0)
  })

  it('si no se puede leer la lista compartida, el host recibe solo la carpeta y la identidad se quita', async () => {
    const { a, b } = installations()
    await b.route({ type: 'pair.declare', profileDirectory: 'Profile 1', identityId: 'bea' })
    const code = await codeOf(a)
    if (fake.state.store !== undefined) fake.state.store.data = { ...dataWith('multi'), schemaVersion: 2 }
    expect(await b.route({ type: 'pair.join', code })).toEqual({ ok: true, result: {} })
    expect(hostEntry('inst-b')?.profileDirectory).toBe('Profile 1')
    expect(hostEntry('inst-b')?.identityId).toBeUndefined()
    expect(installation(b)).toEqual({ installationId: 'inst-b', paired: true, ownProfileDirectory: 'Profile 1' })
  })

  it('si el host responde not_paired al declarar, la instalación queda sin emparejar y conserva lo declarado', async () => {
    const { a, b } = installations()
    await b.route({ type: 'pair.declare', profileDirectory: 'Profile 1', identityId: 'bea' })
    const code = await codeOf(a)
    fake.override = ({ cmd }) => (cmd === 'pair.declare' ? { ok: false, error: { code: 'not_paired' } } : undefined)
    expect(await b.route({ type: 'pair.join', code })).toEqual({ ok: true, result: {} })
    expect(installation(b)).toEqual({
      installationId: 'inst-b',
      paired: false,
      ownProfileDirectory: 'Profile 1',
      ownIdentityId: 'bea',
    })
    expect(Object.keys(b.local.dump())).not.toContain('pairing')
  })

  it('un fallo del host al declarar no deshace el emparejamiento', async () => {
    const { a, b } = installations()
    await b.route({ type: 'pair.declare', profileDirectory: 'Profile 1' })
    const code = await codeOf(a)
    fake.override = ({ cmd }) => (cmd === 'pair.declare' ? { ok: false, error: { code: 'internal' } } : undefined)
    expect(await b.route({ type: 'pair.join', code })).toEqual({ ok: true, result: {} })
    expect(installation(b)).toEqual({ installationId: 'inst-b', paired: true, ownProfileDirectory: 'Profile 1' })
  })
})

describe('pair.verify y whoami.prove', () => {
  it('sin perfil declarado es declare_profile y no llama al host', async () => {
    const { a } = await paired()
    const before = fake.requests.length
    expect(await a.route({ type: 'pair.verify' })).toEqual({
      ok: false,
      error: { code: 'unavailable', hint: 'declare_profile' },
    })
    expect(fake.requests.length).toBe(before)
  })

  it('sin token es not_paired', async () => {
    const { c } = installations()
    expect(await c.route({ type: 'pair.verify' })).toEqual({ ok: false, error: { code: 'not_paired' } })
    expect(fake.requests).toEqual([])
  })

  it('con el token revocado es not_paired y borra el emparejamiento', async () => {
    const { a } = await paired()
    await a.route({ type: 'pair.declare', profileDirectory: 'Default' })
    fake.state.installations.splice(0)
    expect(await a.route({ type: 'pair.verify' })).toEqual({ ok: false, error: { code: 'not_paired' } })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: false, ownProfileDirectory: 'Default' })
  })

  it('verificación completa: pair.verify abre whoami en B, que responde por su service worker', async () => {
    const { b } = await paired()
    await b.route({ type: 'pair.declare', profileDirectory: 'Default' })
    fake.onVerify = (nonce) => {
      void b.route({ type: 'whoami.prove', nonce }, `${WHOAMI_URL}#${nonce}`)
    }
    const verified = await b.route({ type: 'pair.verify' })
    expect(verified).toEqual({ ok: true, result: { expiresAt: expect.any(String) as unknown } })
    // La cola de B atiende el whoami.prove antes que este pair.list.
    const listed = await b.route({ type: 'pair.list' })
    const selves = listed.ok
      ? (listed.result as { installations: { self: boolean; verifiedAt?: string }[] }).installations
      : []
    expect(selves.find((entry) => entry.self)?.verifiedAt).toBe(DEFAULT_NOW)
    expect(selves.find((entry) => !entry.self)?.verifiedAt).toBeUndefined()
  })

  it('el nonce de B probado desde el service worker de A es bad_nonce', async () => {
    const { a, b } = await paired()
    await b.route({ type: 'pair.declare', profileDirectory: 'Default' })
    let nonce = ''
    fake.onVerify = (issued) => {
      nonce = issued
    }
    await b.route({ type: 'pair.verify' })
    expect(nonce).not.toBe('')
    expect(await a.route({ type: 'whoami.prove', nonce }, `${WHOAMI_URL}#${nonce}`)).toEqual({
      ok: false,
      error: { code: 'bad_nonce' },
    })
    // El intento fallido no gasta el nonce: B todavía puede probarlo.
    expect(await b.route({ type: 'whoami.prove', nonce }, WHOAMI_URL)).toEqual({
      ok: true,
      result: { verifiedAt: DEFAULT_NOW },
    })
  })

  it('whoami.prove con el token revocado es not_paired y borra el emparejamiento', async () => {
    const { a } = await paired()
    fake.state.installations.splice(0)
    expect(await a.route({ type: 'whoami.prove', nonce: 'a'.repeat(22) }, WHOAMI_URL)).toEqual({
      ok: false,
      error: { code: 'not_paired' },
    })
    expect(installation(a)).toEqual({ installationId: 'inst-a', paired: false })
  })

  it('whoami.prove sin token es not_paired y no llama al host', async () => {
    const { c } = installations()
    expect(await c.route({ type: 'whoami.prove', nonce: 'a'.repeat(22) }, WHOAMI_URL)).toEqual({
      ok: false,
      error: { code: 'not_paired' },
    })
    expect(fake.requests).toEqual([])
  })

  it('whoami.prove en "Perfil único" no llama al host', async () => {
    fake = createFakeHost()
    registerInstallation(fake, 'inst-a', TOKEN_A)
    const a = createTestEnv({ host: fake, local: pairedLocal('inst-a', TOKEN_A, dataWith('single')) })
    expect(await a.route({ type: 'whoami.prove', nonce: 'a'.repeat(22) }, WHOAMI_URL)).toEqual({
      ok: false,
      error: { code: 'unavailable', hint: 'single_mode' },
    })
    expect(fake.requests).toEqual([])
  })
})

describe('remitentes', () => {
  it('whoami.prove desde /launcher.html es sender', async () => {
    const { a } = await paired()
    const before = fake.requests.length
    const response = await a.route({ type: 'whoami.prove', nonce: 'a'.repeat(22) }, LAUNCHER_URL)
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'sender' } })
    expect(fake.requests.length).toBe(before)
  })

  it('data.get desde /whoami.html es sender', async () => {
    const { a } = await paired()
    expect(await a.route({ type: 'data.get' }, WHOAMI_URL)).toEqual({
      ok: false,
      error: { code: 'invalid', hint: 'sender' },
    })
    expect(await a.route({ type: 'pair.verify' }, WHOAMI_URL)).toEqual({
      ok: false,
      error: { code: 'invalid', hint: 'sender' },
    })
  })

  it.each([
    ['un nonce corto', { type: 'whoami.prove', nonce: 'corto' }],
    ['un campo de más', { type: 'whoami.prove', nonce: 'a'.repeat(22), extra: 1 }],
    ['sin nonce', { type: 'whoami.prove' }],
    ['un nonce que no es texto', { type: 'whoami.prove', nonce: 12 }],
  ])('whoami.prove con %s es invalid sin datos', async (_name, message) => {
    const { a } = await paired()
    const before = fake.requests.length
    expect(await a.route(message, WHOAMI_URL)).toEqual({ ok: false, error: { code: 'invalid' } })
    expect(fake.requests.length).toBe(before)
  })

  it.each([
    ['un array', []],
    ['null', null],
    ['una cadena', 'whoami.prove'],
    ['otro tipo', { type: 'sync.refresh' }],
  ])('desde /whoami.html, %s es sender', async (_name, message) => {
    const { a } = await paired()
    expect(await a.route(message, WHOAMI_URL)).toEqual({ ok: false, error: { code: 'invalid', hint: 'sender' } })
  })

  it('whoami.prove con otro origen es sender', async () => {
    const { a } = await paired()
    const response = await a.route(
      { type: 'whoami.prove', nonce: 'a'.repeat(22) },
      'chrome-extension://otro/whoami.html',
    )
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'sender' } })
  })
})

describe('"Perfil único" y navegador sin host', () => {
  const messages: readonly (readonly [string, unknown])[] = [
    ['pair.start', { type: 'pair.start' }],
    ['pair.join', { type: 'pair.join', code: '123456' }],
    ['pair.declare', { type: 'pair.declare', profileDirectory: 'Default' }],
    ['pair.list', { type: 'pair.list' }],
    ['pair.remove', { type: 'pair.remove', installationId: 'inst-b' }],
    ['pair.verify', { type: 'pair.verify' }],
  ]

  it.each(messages)('%s en single es single_mode y no llama al host', async (_name, message) => {
    fake = createFakeHost()
    const t = createTestEnv({ host: fake, local: unpairedLocal('inst-a', dataWith('single')) })
    expect(await t.route(message)).toEqual({ ok: false, error: { code: 'unavailable', hint: 'single_mode' } })
    expect(fake.requests.length).toBe(0)
  })

  it.each(messages)('%s en single con token sigue siendo single_mode', async (_name, message) => {
    fake = createFakeHost()
    registerInstallation(fake, 'inst-a', TOKEN_A)
    const t = createTestEnv({ host: fake, local: pairedLocal('inst-a', TOKEN_A, dataWith('single')) })
    expect(await t.route(message)).toEqual({ ok: false, error: { code: 'unavailable', hint: 'single_mode' } })
    expect(fake.requests.length).toBe(0)
  })

  it.each(messages)('%s sin host es unsupported_browser', async (_name, message) => {
    fake = createFakeHost()
    const t = createTestEnv({ local: unpairedLocal('inst-a', dataWith('multi')) })
    expect(await t.route(message)).toEqual({ ok: false, error: { code: 'unavailable', hint: 'unsupported_browser' } })
  })

  it('sync.refresh en single devuelve la revisión local sin llamar al host', async () => {
    fake = createFakeHost()
    const t = createTestEnv({ host: fake, local: unpairedLocal('inst-a', dataWith('single', ['ana', 'bea'])) })
    expect(await t.route({ type: 'sync.refresh' })).toEqual({ ok: true, result: { revision: 2 } })
    expect(fake.requests.length).toBe(0)
  })
})
