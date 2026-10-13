import type { Capabilities } from '@account-launcher/protocol'
import { describe, expect, it } from 'vitest'
import { createHostClient } from '../../src/background/host-client'
import { createProviders } from '../../src/providers/providers'
import { createFakeHost } from '../helpers/fake-host'
import { createTestEnv } from '../helpers/env'

const caps: Capabilities = {
  mode: 'multi',
  host: { available: false },
  providers: [
    { id: 'current', available: true },
    { id: 'chromium-profile', available: false, reason: 'host_missing' },
    { id: 'brave-temporary-container', available: true },
  ],
}

describe('createProviders', () => {
  it('available lee caps.providers', () => {
    const providers = createProviders(createTestEnv().deps, undefined)
    expect(providers.available('current', caps)).toBe(true)
    expect(providers.available('chromium-profile', caps)).toBe(false)
    expect(providers.available('brave-temporary-container', caps)).toBe(true)
    expect(providers.available('current', { ...caps, providers: [] })).toBe(false)
  })

  it('sin host, los proveedores del host son unsupported_browser y no abren nada', async () => {
    const t = createTestEnv()
    const providers = createProviders(t.deps, undefined)
    const unsupported = { ok: false, error: { code: 'unavailable', hint: 'unsupported_browser' } }
    expect(await providers.chromiumProfile.open('https://github.com/', 'Default')).toEqual(unsupported)
    expect(await providers.braveTemporaryContainer.open('https://github.com/', 'Default')).toEqual(unsupported)
    expect(t.deps.opened).toEqual([])
  })

  it('con host, los errores del host llegan tal cual', async () => {
    const fake = createFakeHost()
    const host = createHostClient({
      nativeSend: fake.send,
      hostName: fake.hostName,
      sleep: () => new Promise(() => undefined),
    })
    const providers = createProviders(createTestEnv().deps, host)
    expect(await providers.chromiumProfile.open('https://github.com/', 'Nada')).toEqual({
      ok: false,
      error: { code: 'unknown_profile' },
    })
    expect(await providers.braveTemporaryContainer.open('https://github.com/', 'Nada', 'Banco')).toEqual({
      ok: false,
      error: { code: 'unknown_profile' },
    })
    expect(await providers.chromiumProfile.open('https://github.com/', 'Default')).toEqual({
      ok: true,
      value: undefined,
    })
    expect(fake.state.launches).toEqual([{ cmd: 'open', profileDirectory: 'Default', url: 'https://github.com/' }])
  })
})
