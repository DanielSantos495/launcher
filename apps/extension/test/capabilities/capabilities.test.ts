import type { Capabilities, ProviderId, UnavailableReason } from '@account-launcher/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createHostClient, PING_TIMEOUT_MS } from '../../src/background/host-client'
import { getCapabilities } from '../../src/capabilities/capabilities'
import { createFakeHost, type FakeHost, type FakeHostOptions } from '../helpers/fake-host'

const never = (): Promise<void> => new Promise<void>(() => undefined)

function clientFor(fake: FakeHost, sleep: (ms: number) => Promise<void> = never) {
  const sleeps = vi.fn(sleep)
  return { client: createHostClient({ nativeSend: fake.send, hostName: fake.hostName, sleep: sleeps }), sleeps }
}

function unavailable(reason: UnavailableReason): Capabilities['providers'] {
  const providers: ProviderId[] = ['chromium-profile', 'brave-temporary-container']
  return [{ id: 'current', available: true }, ...providers.map((id) => ({ id, available: false, reason }))]
}

async function multi(
  options?: FakeHostOptions,
  setup?: (fake: FakeHost) => void,
  sleep?: (ms: number) => Promise<void>,
) {
  const fake = createFakeHost(options)
  setup?.(fake)
  const { client, sleeps } = clientFor(fake, sleep)
  return { fake, sleeps, caps: await getCapabilities('multi', client) }
}

describe('getCapabilities', () => {
  it('Perfil único: sin host, solo el navegador actual y no se llama al host', async () => {
    const fake = createFakeHost()
    const { client } = clientFor(fake)
    const caps = await getCapabilities('single', client)
    expect(caps).toStrictEqual({ mode: 'single', host: { available: false }, providers: unavailable('single_mode') })
    expect(fake.requests).toHaveLength(0)
  })

  it('Varios perfiles en un navegador no reconocido: unsupported_browser', async () => {
    expect(await getCapabilities('multi', undefined)).toStrictEqual({
      mode: 'multi',
      host: { available: false },
      providers: unavailable('unsupported_browser'),
    })
  })

  it('host no instalado: host_missing', async () => {
    const { caps, fake } = await multi(undefined, (f) => {
      f.mode = 'missing'
    })
    expect(caps).toStrictEqual({ mode: 'multi', host: { available: false }, providers: unavailable('host_missing') })
    expect(fake.requests).toHaveLength(0)
  })

  it('host que no responde: host_missing tras la espera de 3 s', async () => {
    const { caps, sleeps } = await multi(
      undefined,
      (f) => {
        f.mode = 'hang'
      },
      () => Promise.resolve(),
    )
    expect(caps).toStrictEqual({ mode: 'multi', host: { available: false }, providers: unavailable('host_missing') })
    expect(sleeps.mock.calls).toEqual([[PING_TIMEOUT_MS]])
  })

  it('host que termina: host_missing', async () => {
    const { caps } = await multi(undefined, (f) => {
      f.mode = 'exit'
    })
    expect(caps.providers).toStrictEqual(unavailable('host_missing'))
  })

  it('otro error del host al hacer ping: host_missing', async () => {
    const { caps } = await multi(undefined, (f) => {
      f.override = () => ({ ok: false, error: { code: 'internal' } })
    })
    expect(caps.providers).toStrictEqual(unavailable('host_missing'))
  })

  it('unsupported_version: host_outdated', async () => {
    const { caps } = await multi(undefined, (f) => {
      f.override = () => ({ ok: false, error: { code: 'unsupported_version' } })
    })
    expect(caps).toStrictEqual({ mode: 'multi', host: { available: false }, providers: unavailable('host_outdated') })
  })

  it('respuesta que no cumple el contrato: host_outdated', async () => {
    const { caps } = await multi(undefined, (f) => {
      f.override = () => ({
        ok: true,
        result: { hostVersion: '1', protocol: 1, browser: 'brave', features: { temporaryContainer: true }, extra: 1 },
      })
    })
    expect(caps).toStrictEqual({ mode: 'multi', host: { available: false }, providers: unavailable('host_outdated') })
  })

  it('Brave con contenedor temporal: los tres proveedores y el ping', async () => {
    const { caps, fake } = await multi()
    expect(caps).toStrictEqual({
      mode: 'multi',
      host: {
        available: true,
        ping: { hostVersion: '0.1.0', protocol: 1, browser: 'brave', features: { temporaryContainer: true } },
      },
      providers: [
        { id: 'current', available: true },
        { id: 'chromium-profile', available: true },
        { id: 'brave-temporary-container', available: true },
      ],
    })
    expect(fake.requests).toEqual([{ cmd: 'ping', args: {} }])
  })

  it('Chrome: perfiles sí, contenedor temporal no', async () => {
    const { caps } = await multi({ browser: 'chrome' })
    expect(caps).toStrictEqual({
      mode: 'multi',
      host: {
        available: true,
        ping: { hostVersion: '0.1.0', protocol: 1, browser: 'chrome', features: { temporaryContainer: false } },
      },
      providers: [
        { id: 'current', available: true },
        { id: 'chromium-profile', available: true },
        { id: 'brave-temporary-container', available: false, reason: 'unsupported_browser' },
      ],
    })
  })

  it('Brave con temporaryContainer: false: unsupported_browser', async () => {
    const { caps } = await multi({ temporaryContainer: false })
    expect(caps.providers).toStrictEqual([
      { id: 'current', available: true },
      { id: 'chromium-profile', available: true },
      { id: 'brave-temporary-container', available: false, reason: 'unsupported_browser' },
    ])
  })

  it('Edge anunciando contenedor temporal tampoco lo ofrece: solo cuenta en Brave', async () => {
    const { caps } = await multi({ browser: 'edge', temporaryContainer: true })
    expect(caps.providers.at(-1)).toStrictEqual({
      id: 'brave-temporary-container',
      available: false,
      reason: 'unsupported_browser',
    })
  })
})
