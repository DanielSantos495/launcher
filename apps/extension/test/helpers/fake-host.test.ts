import { createEmptyData } from '@account-launcher/core'
import {
  hostRequest,
  parseHostResponse,
  type HostArgs,
  type HostCommand,
  type HostFailure,
  type HostResult,
} from '@account-launcher/protocol'
import { describe, expect, it } from 'vitest'
import requestsFixture from '../../../../packages/protocol/fixtures/host-requests.json'
import { createFakeHost, type FakeHost } from './fake-host'

interface RequestCase {
  name: string
  valid: boolean
  request: object
}

const requests = requestsFixture as RequestCase[]
const TOKEN = 'A'.repeat(43)

// Envía una petición bien formada y valida la respuesta con el contrato, como hace el cliente.
async function call<C extends HostCommand>(
  fake: FakeHost,
  cmd: C,
  args: HostArgs<C>,
): Promise<{ ok: true; value: HostResult<C> } | { ok: false; error: HostFailure }> {
  return parseHostResponse(cmd, await fake.send(fake.hostName, hostRequest(cmd, args)))
}

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: HostFailure }): T {
  if (!result.ok) throw new Error(`se esperaba ok y llegó ${result.error.code}`)
  return result.value
}

describe('el host falso cumple el contrato (host-requests.json)', () => {
  it.each(requests.filter((c) => !c.valid).map((c) => [c.name, c] as const))('rechaza: %s', async (_name, c) => {
    const fake = createFakeHost()
    expect(await fake.send(fake.hostName, c.request)).toMatchObject({ ok: false })
  })

  it.each(requests.filter((c) => c.valid).map((c) => [c.name, c] as const))(
    'no rechaza por forma: %s',
    async (_n, c) => {
      const fake = createFakeHost()
      const response = await fake.send(fake.hostName, c.request)
      expect(response).not.toEqual({ ok: false, error: { code: 'bad_request' } })
      expect(fake.invalidRequests).toBe(0)
    },
  )

  it('cuenta las peticiones que no cumplen el esquema y no las registra', async () => {
    const fake = createFakeHost()
    expect(await fake.send(fake.hostName, { v: 1, cmd: 'ping', args: { extra: 1 } })).toEqual({
      ok: false,
      error: { code: 'bad_request' },
    })
    expect(fake.invalidRequests).toBe(1)
    expect(fake.requests).toEqual([])
  })

  it('un mensaje de más de 1 MiB es too_large', async () => {
    const fake = createFakeHost()
    const big = { v: 1, cmd: 'ping', args: {}, padding: 'x'.repeat(1024 * 1024) }
    expect(await fake.send(fake.hostName, big)).toEqual({ ok: false, error: { code: 'too_large' } })
    expect(fake.invalidRequests).toBe(0)
  })
})

describe('el host falso: modos y nombre', () => {
  it('missing, exit y un nombre de host ajeno rechazan con el texto de Chromium; hang no responde', async () => {
    const message = hostRequest('ping', {})
    const fake = createFakeHost()
    fake.mode = 'missing'
    await expect(fake.send(fake.hostName, message)).rejects.toThrow('Specified native messaging host not found.')
    fake.mode = 'exit'
    await expect(fake.send(fake.hostName, message)).rejects.toThrow('Native host has exited.')
    fake.mode = 'normal'
    await expect(fake.send('com.curyapps.launcher.chrome', message)).rejects.toThrow('not found')
    fake.mode = 'hang'
    const outcome = await Promise.race([fake.send(fake.hostName, message), Promise.resolve('pendiente')])
    expect(outcome).toBe('pendiente')
  })

  it('hostName sigue a la marca elegida', () => {
    expect(createFakeHost().hostName).toBe('com.curyapps.launcher.brave')
    expect(createFakeHost({ browser: 'edge' }).hostName).toBe('com.curyapps.launcher.edge')
  })

  it('override devuelve la respuesta cruda y se anota la petición', async () => {
    const fake = createFakeHost()
    fake.override = (request) => (request.cmd === 'ping' ? { cualquier: 'cosa' } : undefined)
    expect(await fake.send(fake.hostName, hostRequest('ping', {}))).toEqual({ cualquier: 'cosa' })
    expect((await call(fake, 'listProfiles', {})).ok).toBe(true)
    expect(fake.requests.map((r) => r.cmd)).toEqual(['ping', 'listProfiles'])
  })
})

describe('el host falso: navegador y perfiles', () => {
  it('ping describe el navegador y la función de contenedor temporal', async () => {
    const brave = expectOk(await call(createFakeHost(), 'ping', {}))
    expect(brave).toEqual({
      hostVersion: '0.1.0',
      protocol: 1,
      browser: 'brave',
      features: { temporaryContainer: true },
    })
    const chrome = expectOk(await call(createFakeHost({ browser: 'chrome' }), 'ping', {}))
    expect(chrome).toMatchObject({ browser: 'chrome', features: { temporaryContainer: false } })
    const forced = expectOk(await call(createFakeHost({ browser: 'edge', temporaryContainer: true }), 'ping', {}))
    expect(forced).toMatchObject({ browser: 'edge', features: { temporaryContainer: true } })
  })

  it('listProfiles devuelve los de serie y los creados aparecen tras createProfileVisibleAfter llamadas', async () => {
    const fake = createFakeHost()
    fake.createProfileVisibleAfter = 2
    expect(expectOk(await call(fake, 'listProfiles', {})).profiles).toEqual([
      { directory: 'Default', name: 'Personal', isUsingDefaultName: false },
      { directory: 'Profile 1', name: 'Persona 1', isUsingDefaultName: true },
    ])
    const { directory } = expectOk(await call(fake, 'createProfile', {}))
    expect(directory).toMatch(/^Launcher-[0-9a-f]{8}$/)
    expect(expectOk(await call(fake, 'listProfiles', {})).profiles).toHaveLength(2)
    const shown = expectOk(await call(fake, 'listProfiles', {})).profiles
    expect(shown).toHaveLength(3)
    expect(shown.at(-1)).toEqual({ directory, name: 'Persona 2', isUsingDefaultName: true })
  })

  it('open registra el lanzamiento y rechaza una carpeta desconocida', async () => {
    const fake = createFakeHost()
    expect(expectOk(await call(fake, 'open', { profileDirectory: 'Default', url: 'https://github.com/' }))).toEqual({})
    expect(await call(fake, 'open', { profileDirectory: 'Nada', url: 'https://github.com/' })).toEqual({
      ok: false,
      error: { code: 'unknown_profile' },
    })
    expect(fake.state.launches).toEqual([{ cmd: 'open', profileDirectory: 'Default', url: 'https://github.com/' }])
  })

  it('openTemporary: navegador, carpeta y nombre en uso (sin distinguir mayúsculas)', async () => {
    const args = { profileDirectory: 'Profile 1', url: 'https://example.com/' }
    const chrome = createFakeHost({ browser: 'chrome' })
    expect(await call(chrome, 'openTemporary', args)).toEqual({ ok: false, error: { code: 'unsupported_browser' } })
    const fake = createFakeHost({ persistentContainers: { 'Profile 1': ['Trabajo'] } })
    expect(await call(fake, 'openTemporary', { ...args, profileDirectory: 'Nada' })).toEqual({
      ok: false,
      error: { code: 'unknown_profile' },
    })
    expect(await call(fake, 'openTemporary', { ...args, name: 'TRABAJO' })).toEqual({
      ok: false,
      error: { code: 'name_in_use' },
    })
    expectOk(await call(fake, 'openTemporary', { ...args, name: 'Banco' }))
    expectOk(await call(fake, 'openTemporary', args))
    expect(fake.state.launches).toEqual([
      { cmd: 'openTemporary', profileDirectory: 'Profile 1', url: 'https://example.com/', name: 'Banco' },
      { cmd: 'openTemporary', profileDirectory: 'Profile 1', url: 'https://example.com/' },
    ])
  })
})

describe('el host falso: emparejamiento y datos compartidos', () => {
  it('pair.start sin token crea el almacén; repetirlo sin token es not_paired (DC13)', async () => {
    const fake = createFakeHost()
    const first = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.code).toMatch(/^\d{6}$/)
    expect(first.expiresAt).toBe('2026-10-08T12:02:00.000Z')
    expect(fake.state.store).toEqual({ revision: 0, data: null, bindings: {} })
    expect(await call(fake, 'pair.start', { installationId: 'inst-b' })).toEqual({
      ok: false,
      error: { code: 'not_paired' },
    })
    expect(await call(fake, 'pair.start', { installationId: 'inst-a', token: TOKEN })).toEqual({
      ok: false,
      error: { code: 'not_paired' },
    })
    const again = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a', token: first.token ?? '' }))
    expect(again.token).toBeUndefined()
    expect(again.code).not.toBe(first.code)
  })

  it('pair.join: un código desconocido o ya usado es bad_code', async () => {
    const fake = createFakeHost()
    const { token, code } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    expect(await call(fake, 'pair.join', { installationId: 'inst-b', code: '000000' })).toEqual({
      ok: false,
      error: { code: 'bad_code' },
    })
    const joined = expectOk(await call(fake, 'pair.join', { installationId: 'inst-b', code }))
    expect(joined.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(joined.token).not.toBe(token)
    // El código ya se usó.
    expect(await call(fake, 'pair.join', { installationId: 'inst-c', code })).toEqual({
      ok: false,
      error: { code: 'bad_code' },
    })
  })

  it('un código caduca a los 120 s', async () => {
    let clock = new Date('2026-10-08T12:00:00.000Z')
    const fake = createFakeHost({ now: () => clock })
    const { code } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    clock = new Date('2026-10-08T12:02:01.000Z')
    expect(await call(fake, 'pair.join', { installationId: 'inst-b', code })).toEqual({
      ok: false,
      error: { code: 'bad_code' },
    })
  })

  it('pair.start con token y el máximo de perfiles emparejado es limit_reached y no emite código', async () => {
    const fake = createFakeHost()
    const { token } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    // Con un solo perfil (máximo 2) todavía se emite.
    const { code } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a', token: token ?? '' }))
    expectOk(await call(fake, 'pair.join', { installationId: 'inst-b', code }))
    expect(fake.state.installations).toHaveLength(2)
    expect(await call(fake, 'pair.start', { installationId: 'inst-a', token: token ?? '' })).toEqual({
      ok: false,
      error: { code: 'limit_reached' },
    })
  })

  it('pair.join con el máximo alcanzado es limit_reached y gasta el código', async () => {
    const fake = createFakeHost({ maxPairedProfiles: 1 })
    const { code } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    expect(await call(fake, 'pair.join', { installationId: 'inst-b', code })).toEqual({
      ok: false,
      error: { code: 'limit_reached' },
    })
    // El código se consumió: ni siquiera se admite al quitar sitio.
    fake.state.installations.length = 0
    expect(await call(fake, 'pair.join', { installationId: 'inst-b', code })).toEqual({
      ok: false,
      error: { code: 'bad_code' },
    })
  })

  it('solo hay un código vigente: uno nuevo sustituye al anterior', async () => {
    const fake = createFakeHost()
    const { token, code: first } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    const second = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a', token: token ?? '' }))
    expect(second.code).not.toBe(first)
    expect(await call(fake, 'pair.join', { installationId: 'inst-b', code: first })).toEqual({
      ok: false,
      error: { code: 'bad_code' },
    })
    expectOk(await call(fake, 'pair.join', { installationId: 'inst-b', code: second.code }))
  })

  it('tras 5 pair.join fallidos el código vigente se anula; con 4 todavía vale', async () => {
    const wrong = async (fake: FakeHost, times: number): Promise<void> => {
      for (let attempt = 0; attempt < times; attempt++) {
        expect(await call(fake, 'pair.join', { installationId: 'inst-x', code: '999999' })).toEqual({
          ok: false,
          error: { code: 'bad_code' },
        })
      }
    }
    const four = createFakeHost()
    const open = expectOk(await call(four, 'pair.start', { installationId: 'inst-a' }))
    await wrong(four, 4)
    expectOk(await call(four, 'pair.join', { installationId: 'inst-b', code: open.code }))

    const five = createFakeHost()
    const annulled = expectOk(await call(five, 'pair.start', { installationId: 'inst-a' }))
    await wrong(five, 5)
    expect(await call(five, 'pair.join', { installationId: 'inst-b', code: annulled.code })).toEqual({
      ok: false,
      error: { code: 'bad_code' },
    })
    expect(five.state.installations).toHaveLength(1)
  })

  it('pair.start sin token con un almacén sin instalaciones vuelve a ser el primer emparejamiento y conserva los datos', async () => {
    const fake = createFakeHost()
    fake.state.store = { revision: 7, data: { schemaVersion: 1, guardado: true }, bindings: { ana: {} } }
    const started = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    expect(started.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(started.code).toMatch(/^\d{6}$/)
    expect(fake.state.installations.map((i) => i.installationId)).toEqual(['inst-a'])
    expect(fake.state.store).toEqual({ revision: 7, data: { schemaVersion: 1, guardado: true }, bindings: { ana: {} } })
    // Con una instalación emparejada vuelve a ser not_paired.
    expect(await call(fake, 'pair.start', { installationId: 'inst-b' })).toEqual({
      ok: false,
      error: { code: 'not_paired' },
    })
  })

  it('declare, list y remove; un token revocado o desconocido es not_paired', async () => {
    const fake = createFakeHost()
    const { token, code } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    const { token: tokenB } = expectOk(await call(fake, 'pair.join', { installationId: 'inst-b', code }))
    expectOk(await call(fake, 'pair.declare', { token: tokenB, profileDirectory: 'Profile 1', identityId: 'ana' }))
    const listed = expectOk(await call(fake, 'pair.list', { token: tokenB }))
    expect(listed.maxPairedProfiles).toBe(2)
    expect(listed.installations).toEqual([
      { installationId: 'inst-a', pairedAt: '2026-10-08T12:00:00.000Z', self: false },
      {
        installationId: 'inst-b',
        identityId: 'ana',
        profileDirectory: 'Profile 1',
        pairedAt: '2026-10-08T12:00:00.000Z',
        self: true,
      },
    ])
    expect(await call(fake, 'pair.remove', { token: token ?? '', installationId: 'nadie' })).toEqual({
      ok: false,
      error: { code: 'not_found' },
    })
    expectOk(await call(fake, 'pair.remove', { token: token ?? '', installationId: 'inst-b' }))
    expect(await call(fake, 'pair.list', { token: tokenB })).toEqual({ ok: false, error: { code: 'not_paired' } })
    expect(await call(fake, 'sync.get', { token: TOKEN })).toEqual({ ok: false, error: { code: 'not_paired' } })
  })

  it('verify y prove: sin perfil declarado, nonce de otra instalación, caducado o usado', async () => {
    let clock = new Date('2026-10-08T12:00:00.000Z')
    const fake = createFakeHost({ now: () => clock })
    const nonces: { nonce: string; profileDirectory: string }[] = []
    fake.onVerify = (nonce, profileDirectory) => nonces.push({ nonce, profileDirectory })
    const { token, code } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    const { token: tokenB } = expectOk(await call(fake, 'pair.join', { installationId: 'inst-b', code }))
    expect(await call(fake, 'pair.verify', { token: tokenB })).toEqual({ ok: false, error: { code: 'not_found' } })
    expectOk(await call(fake, 'pair.declare', { token: tokenB, profileDirectory: 'Profile 1' }))
    expect(expectOk(await call(fake, 'pair.verify', { token: tokenB })).expiresAt).toBe('2026-10-08T12:01:00.000Z')
    const [issued] = nonces
    expect(issued?.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(issued?.profileDirectory).toBe('Profile 1')
    const nonce = issued?.nonce ?? ''
    expect(await call(fake, 'pair.prove', { token: token ?? '', nonce })).toEqual({
      ok: false,
      error: { code: 'bad_nonce' },
    })
    expect(expectOk(await call(fake, 'pair.prove', { token: tokenB, nonce })).verifiedAt).toBe(
      '2026-10-08T12:00:00.000Z',
    )
    expect(fake.state.installations.find((i) => i.installationId === 'inst-b')?.verifiedAt).toBe(
      '2026-10-08T12:00:00.000Z',
    )
    expect(await call(fake, 'pair.prove', { token: tokenB, nonce })).toEqual({
      ok: false,
      error: { code: 'bad_nonce' },
    })
    expectOk(await call(fake, 'pair.verify', { token: tokenB }))
    clock = new Date('2026-10-08T12:01:01.000Z')
    expect(await call(fake, 'pair.prove', { token: tokenB, nonce: nonces[1]?.nonce ?? '' })).toEqual({
      ok: false,
      error: { code: 'bad_nonce' },
    })
  })

  it('pair.verify con un perfil declarado que ya no existe es unknown_profile', async () => {
    const fake = createFakeHost()
    const { token } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    expectOk(await call(fake, 'pair.declare', { token: token ?? '', profileDirectory: 'Profile 1' }))
    fake.state.profiles = fake.state.profiles.filter((profile) => profile.directory !== 'Profile 1')
    expect(await call(fake, 'pair.verify', { token: token ?? '' })).toEqual({
      ok: false,
      error: { code: 'unknown_profile' },
    })
    // Sin nonce emitido: nadie puede probar nada.
    expect(fake.state.installations[0]?.verifiedAt).toBeUndefined()
  })

  it('pair.declare con otra carpeta borra verifiedAt y con la misma lo conserva', async () => {
    const fake = createFakeHost()
    fake.onVerify = () => undefined
    const { token } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    const t = token ?? ''
    expectOk(await call(fake, 'pair.declare', { token: t, profileDirectory: 'Profile 1' }))
    const [installation] = fake.state.installations
    if (installation === undefined) throw new Error('falta la instalación')
    installation.verifiedAt = '2026-10-08T12:00:00.000Z'
    expectOk(await call(fake, 'pair.declare', { token: t, profileDirectory: 'Profile 1', identityId: 'ana' }))
    expect(installation.verifiedAt).toBe('2026-10-08T12:00:00.000Z')
    expectOk(await call(fake, 'pair.declare', { token: t, profileDirectory: 'Default' }))
    expect(installation.verifiedAt).toBeUndefined()
    expect(installation.profileDirectory).toBe('Default')
  })

  it('sync.put sube la revisión, detecta conflictos y limita los tamaños', async () => {
    const fake = createFakeHost()
    const { token } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    const t = token ?? ''
    expect(expectOk(await call(fake, 'sync.get', { token: t }))).toEqual({ revision: 0, data: null, bindings: {} })
    const data = createEmptyData()
    expect(expectOk(await call(fake, 'sync.put', { token: t, baseRevision: 0, data, bindings: {} }))).toEqual({
      revision: 1,
    })
    expect(await call(fake, 'sync.put', { token: t, baseRevision: 0, data, bindings: {} })).toEqual({
      ok: false,
      error: { code: 'conflict', revision: 1 },
    })
    expect(expectOk(await call(fake, 'sync.get', { token: t }))).toEqual({ revision: 1, data, bindings: {} })
    const fat = { ...data, customServices: [], identities: [], groups: [] }
    const notes = 'n'.repeat(2000)
    const accounts = Array.from({ length: 300 }, (_, i) => ({
      id: `a${String(i)}`,
      identityId: 'ana',
      groupId: null,
      serviceId: 'github' as const,
      label: 'x',
      notes,
      icon: { type: 'auto' as const },
      favorite: false,
      order: 0,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    }))
    expect(
      await call(fake, 'sync.put', { token: t, baseRevision: 1, data: { ...fat, accounts }, bindings: {} }),
    ).toEqual({
      ok: false,
      error: { code: 'too_large' },
    })
    expect(fake.state.store?.revision).toBe(1)
  })

  it('sync.put mide el tamaño antes que el token y la revisión, como el host real', async () => {
    const fake = createFakeHost()
    const notes = 'n'.repeat(2000)
    const accounts = Array.from({ length: 300 }, (_, i) => ({
      id: `a${String(i)}`,
      identityId: 'ana',
      groupId: null,
      serviceId: 'github' as const,
      label: 'x',
      notes,
      icon: { type: 'auto' as const },
      favorite: false,
      order: 0,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    }))
    const data = { ...createEmptyData(), accounts }
    // Token que no está emparejado y revisión que no coincide: el tamaño gana a los dos.
    expect(await call(fake, 'sync.put', { token: 'B'.repeat(43), baseRevision: 7, data, bindings: {} })).toEqual({
      ok: false,
      error: { code: 'too_large' },
    })
  })

  it('una sesión con los 14 comandos de F1 termina sin que el falso lance', async () => {
    const fake = createFakeHost()
    let issued = ''
    fake.onVerify = (nonce) => {
      issued = nonce
    }
    expectOk(await call(fake, 'ping', {}))
    expectOk(await call(fake, 'listProfiles', {}))
    expectOk(await call(fake, 'open', { profileDirectory: 'Default', url: 'https://github.com/' }))
    expectOk(await call(fake, 'openTemporary', { profileDirectory: 'Profile 1', url: 'https://example.com/' }))
    expectOk(await call(fake, 'createProfile', {}))
    const { token } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    const a = token ?? ''
    const { code } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a', token: a }))
    const b = expectOk(await call(fake, 'pair.join', { installationId: 'inst-b', code })).token
    expectOk(await call(fake, 'pair.declare', { token: b, profileDirectory: 'Profile 1' }))
    expectOk(await call(fake, 'pair.list', { token: b }))
    expectOk(await call(fake, 'pair.verify', { token: b }))
    expectOk(await call(fake, 'pair.prove', { token: b, nonce: issued }))
    expectOk(await call(fake, 'sync.get', { token: a }))
    expectOk(await call(fake, 'sync.put', { token: a, baseRevision: 0, data: createEmptyData(), bindings: {} }))
    expectOk(await call(fake, 'pair.remove', { token: a, installationId: 'inst-b' }))
    expect(fake.invalidRequests).toBe(0)
    expect(fake.requests.map((r) => r.cmd)).toEqual([
      'ping',
      'listProfiles',
      'open',
      'openTemporary',
      'createProfile',
      'pair.start',
      'pair.start',
      'pair.join',
      'pair.declare',
      'pair.list',
      'pair.verify',
      'pair.prove',
      'sync.get',
      'sync.put',
      'pair.remove',
    ])
  })
})

describe('iconos del host falso (como internal/store/icons.go)', () => {
  const PNG = 'iVBORw0KGgo='

  async function paired(maxIcons?: number): Promise<{ fake: FakeHost; token: string }> {
    const fake = createFakeHost(maxIcons === undefined ? {} : { maxIcons })
    const { token } = expectOk(await call(fake, 'pair.start', { installationId: 'inst-a' }))
    return { fake, token: token ?? '' }
  }

  it('put, get y delete; borrar una clave inexistente no es un error', async () => {
    const { fake, token } = await paired()
    const key = 'icon:a'
    expect(await call(fake, 'icons.get', { token, key })).toEqual({ ok: false, error: { code: 'not_found' } })
    expectOk(await call(fake, 'icons.put', { token, key, mime: 'image/png', base64: PNG }))
    expect(expectOk(await call(fake, 'icons.get', { token, key }))).toEqual({ key, mime: 'image/png', base64: PNG })
    expectOk(await call(fake, 'icons.delete', { token, key }))
    expectOk(await call(fake, 'icons.delete', { token, key }))
    expect(fake.state.icons.size).toBe(0)
  })

  it('el tope cuenta claves nuevas: reemplazar una existente no suma', async () => {
    const { fake, token } = await paired(1)
    expectOk(await call(fake, 'icons.put', { token, key: 'icon:a', mime: 'image/png', base64: PNG }))
    expectOk(await call(fake, 'icons.put', { token, key: 'icon:a', mime: 'image/png', base64: PNG }))
    expect(await call(fake, 'icons.put', { token, key: 'icon:b', mime: 'image/png', base64: PNG })).toEqual({
      ok: false,
      error: { code: 'limit_reached' },
    })
  })

  it('un token desconocido es not_paired', async () => {
    const { fake } = await paired()
    const response = await call(fake, 'icons.get', { token: 'B'.repeat(43), key: 'icon:a' })
    expect(response).toEqual({ ok: false, error: { code: 'not_paired' } })
  })
})
