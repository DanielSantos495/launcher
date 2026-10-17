import { createEmptyData, type Account } from '@account-launcher/core'
import { hostRequest, MAX_HOST_REQUEST_BYTES } from '@account-launcher/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createHostClient, HOST_TIMEOUT_MS, PING_TIMEOUT_MS } from '../../src/background/host-client'
import { jsonBytes } from '../../src/storage/usage'
import { createFakeHost, type FakeHostOptions } from '../helpers/fake-host'

const TOKEN = 'A'.repeat(43)
const AT = '2026-10-01T10:00:00.000Z'
type SendNative = (hostName: string, message: object) => Promise<unknown>
const never = (): Promise<void> => new Promise<void>(() => undefined)

function setup(options?: FakeHostOptions, sleep: (ms: number) => Promise<void> = never) {
  const fake = createFakeHost(options)
  const sent: { hostName: string; message: object }[] = []
  const sleeps = vi.fn(sleep)
  const client = createHostClient({
    nativeSend: (hostName, message) => {
      sent.push({ hostName, message })
      return fake.send(hostName, message)
    },
    hostName: fake.hostName,
    sleep: sleeps,
  })
  if (client === undefined) throw new Error('el cliente debería existir')
  return { fake, client, sent, sleeps }
}

function account(index: number, notes: string): Account {
  return {
    id: `a${String(index)}`,
    identityId: 'ana',
    groupId: null,
    serviceId: 'github',
    label: 'x',
    notes,
    icon: { type: 'auto' },
    favorite: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  }
}

function putArgs(accounts: Account[]) {
  return { token: TOKEN, baseRevision: 0, data: { ...createEmptyData(), accounts }, bindings: {} }
}

// sync.put válido cuyo cuerpo JSON mide exactamente `target` bytes: cuentas con notas de 1000 caracteres y una última
// con las notas justas (todo ASCII, un byte por carácter).
function putOfSize(target: number) {
  const accounts: Account[] = []
  let size = jsonBytes(hostRequest('sync.put', putArgs([account(0, '')])))
  while (size + 1900 < target) {
    const filler = account(accounts.length + 1, 'n'.repeat(1000))
    accounts.push(filler)
    size += jsonBytes(filler) + 1
  }
  const last = account(0, 'n'.repeat(target - size))
  return putArgs([last, ...accounts])
}

describe('createHostClient', () => {
  it('sin hostName (navegador no reconocido) no hay cliente', () => {
    expect(createHostClient({ nativeSend: () => Promise.resolve(), hostName: undefined, sleep: never })).toBeUndefined()
  })
})

describe('HostClient.call: petición', () => {
  it('envía { v: 1, cmd, args } con el nombre del host y devuelve el resultado', async () => {
    const { fake, client, sent } = setup()
    const args = { profileDirectory: 'Default', url: 'https://github.com/' }
    expect(await client.call('open', args)).toEqual({ ok: true, value: {} })
    expect(fake.requests[0]).toEqual({ cmd: 'open', args })
    expect(sent).toEqual([{ hostName: 'com.curyapps.launcher.brave', message: { v: 1, cmd: 'open', args } }])
    expect(fake.invalidRequests).toBe(0)
  })

  it('una URL fuera de la gramática G no se envía: internal bad_host_request', async () => {
    const { fake, client, sent } = setup()
    const result = await client.call('open', { profileDirectory: 'Default', url: 'https://Example.com/' })
    expect(result).toEqual({ ok: false, error: { code: 'internal', hint: 'bad_host_request' } })
    expect(sent).toEqual([])
    expect(fake.requests).toHaveLength(0)
    expect(JSON.stringify(result)).not.toContain('Example')
  })

  it('un sync.put válido de más de 1 MiB no se envía: too_large request_too_large', async () => {
    const { fake, client, sent } = setup()
    const accounts = Array.from({ length: 2000 }, (_, i) => account(i, 'n'.repeat(2000)))
    const result = await client.call('sync.put', putArgs(accounts))
    expect(result).toEqual({ ok: false, error: { code: 'too_large', hint: 'request_too_large' } })
    expect(sent).toEqual([])
    expect(fake.requests).toHaveLength(0)
  })

  it('el límite es de 1 MiB exactos: con el máximo se envía, con el máximo + 1 no', async () => {
    const atLimit = putOfSize(MAX_HOST_REQUEST_BYTES)
    expect(jsonBytes(hostRequest('sync.put', atLimit))).toBe(MAX_HOST_REQUEST_BYTES)
    const sentCase = setup()
    // Se envía: responde el host (sin pista, y antes que por el token, como el real) y no el cliente por el tamaño.
    expect(await sentCase.client.call('sync.put', atLimit)).toEqual({ ok: false, error: { code: 'too_large' } })
    expect(sentCase.fake.requests).toHaveLength(1)

    const over = putOfSize(MAX_HOST_REQUEST_BYTES + 1)
    expect(jsonBytes(hostRequest('sync.put', over))).toBe(MAX_HOST_REQUEST_BYTES + 1)
    const blocked = setup()
    expect(await blocked.client.call('sync.put', over)).toEqual({
      ok: false,
      error: { code: 'too_large', hint: 'request_too_large' },
    })
    expect(blocked.fake.requests).toHaveLength(0)
  })
})

describe('HostClient.call: fallos de transporte', () => {
  it('host ausente es host_missing, sin pista', async () => {
    const { fake, client } = setup()
    fake.mode = 'missing'
    expect(await client.call('ping', {})).toEqual({ ok: false, error: { code: 'host_missing' } })
  })

  it('un host que termina es host_error host_failed y no repite el texto del error', async () => {
    const { fake, client } = setup()
    fake.mode = 'exit'
    const result = await client.call('ping', {})
    expect(result).toEqual({ ok: false, error: { code: 'host_error', hint: 'host_failed' } })
    expect(JSON.stringify(result)).not.toContain('exited')
  })

  it.each([
    ['un Error con "not found"', () => new Error('Specified native messaging host not found.')],
    ['un Error con "forbidden"', () => new Error('Access to the specified native messaging host is forbidden.')],
    ['mayúsculas', () => new Error('HOST NOT FOUND')],
    ['un objeto con message', () => ({ message: 'host is Forbidden' })],
    ['un texto', () => 'Specified native messaging host not found.'],
  ])('%s es host_missing', async (_name, failure) => {
    const client = createHostClient({
      nativeSend: vi.fn<SendNative>().mockRejectedValue(failure()),
      hostName: 'com.curyapps.launcher.brave',
      sleep: never,
    })
    expect(await client?.call('ping', {})).toEqual({ ok: false, error: { code: 'host_missing' } })
  })

  it.each([
    ['otro texto', () => new Error('algo distinto /Users/ana')],
    ['algo que no es un error', () => 42],
    ['un objeto sin message', () => ({ code: 1 })],
  ])('%s es host_failed y no se copia', async (_name, failure) => {
    const client = createHostClient({
      nativeSend: vi.fn<SendNative>().mockRejectedValue(failure()),
      hostName: 'com.curyapps.launcher.brave',
      sleep: never,
    })
    const result = await client?.call('ping', {})
    expect(result).toEqual({ ok: false, error: { code: 'host_error', hint: 'host_failed' } })
    expect(JSON.stringify(result)).not.toContain('Users')
  })

  it('una excepción síncrona de nativeSend también es host_failed', async () => {
    const client = createHostClient({
      nativeSend: () => {
        throw new Error('boom')
      },
      hostName: 'com.curyapps.launcher.brave',
      sleep: never,
    })
    expect(await client?.call('ping', {})).toEqual({ ok: false, error: { code: 'host_error', hint: 'host_failed' } })
  })

  it('un host que no responde vence con timeout cuando la espera termina', async () => {
    const { fake, client, sleeps } = setup(undefined, () => Promise.resolve())
    fake.mode = 'hang'
    expect(await client.call('ping', {})).toEqual({ ok: false, error: { code: 'host_error', hint: 'timeout' } })
    expect(sleeps).toHaveBeenCalledTimes(1)
  })

  it('la espera es de 10 s por defecto y la de la opción si se indica', async () => {
    const { client, sleeps } = setup()
    expect(HOST_TIMEOUT_MS).toBe(10_000)
    expect(PING_TIMEOUT_MS).toBe(3_000)
    await client.call('ping', {})
    await client.call('ping', {}, { timeoutMs: 3000 })
    expect(sleeps.mock.calls).toEqual([[10000], [3000]])
  })

  it('una respuesta a tiempo gana a una espera que no termina', async () => {
    const { client } = setup()
    const result = await client.call('ping', {})
    expect(result).toEqual({
      ok: true,
      value: { hostVersion: '0.1.0', protocol: 1, browser: 'brave', features: { temporaryContainer: true } },
    })
  })
})

describe('HostClient.call: respuesta', () => {
  it('un campo de más en la respuesta es host_error bad_response', async () => {
    const { fake, client } = setup()
    fake.override = () => ({
      ok: true,
      result: { hostVersion: '1', protocol: 1, browser: 'brave', features: { temporaryContainer: true }, extra: 1 },
    })
    expect(await client.call('ping', {})).toEqual({ ok: false, error: { code: 'host_error', hint: 'bad_response' } })
  })

  it.each([null, 'ok', [], { ok: true }])('una respuesta que no es del contrato (%j) es bad_response', async (raw) => {
    const { fake, client } = setup()
    fake.override = () => raw
    expect(await client.call('ping', {})).toEqual({ ok: false, error: { code: 'host_error', hint: 'bad_response' } })
  })

  it('un error del host llega tal cual, sin pista', async () => {
    const { client } = setup()
    const result = await client.call('open', { profileDirectory: 'Nada', url: 'https://github.com/' })
    expect(result).toStrictEqual({ ok: false, error: { code: 'unknown_profile' } })
  })

  it('conflict conserva la revisión', async () => {
    const { fake, client } = setup()
    fake.override = () => ({ ok: false, error: { code: 'conflict', revision: 5 } })
    const result = await client.call('sync.get', { token: TOKEN })
    expect(result).toStrictEqual({ ok: false, error: { code: 'conflict', revision: 5 } })
  })
})
