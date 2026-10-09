import { createEmptyData, err } from '@account-launcher/core'
import { describe, expect, it } from 'vitest'
import { loadContext } from '../../src/background/context'
import { createTestEnv } from '../helpers/env'

const TOKEN = 'B'.repeat(43)

describe('loadContext (almacén local)', () => {
  it('en una instalación nueva crea la instalación y lee datos vacíos del almacén local', async () => {
    const { env, local } = createTestEnv()
    const result = await loadContext(env)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const context = result.value
    expect(context.installation).toEqual({ installationId: 'id-1', paired: false })
    expect(context.token).toBeUndefined()
    expect(context.mode).toBe('single')
    expect(context.source).toBe('local')
    expect(context.store).toBe(context.local)
    expect(context.store.source).toBe('local')
    expect(context.localSnapshot).toEqual({ data: createEmptyData(), bindings: {} })
    expect(local.dump()).toEqual({ installation: { installationId: 'id-1', paired: false } })
  })

  it('el modo sale de los ajustes de los datos locales', async () => {
    const localData = { ...createEmptyData(), settings: { ...createEmptyData().settings, mode: 'multi' } }
    const { env } = createTestEnv({ local: { localData } })
    const result = await loadContext(env)
    expect(result.ok && result.value.mode).toBe('multi')
  })

  it('con la instalación emparejada y el token válido, devuelve el token', async () => {
    const { env } = createTestEnv({
      local: { installation: { installationId: 'abc', paired: true }, pairing: { token: TOKEN } },
    })
    const result = await loadContext(env)
    expect(result.ok && result.value.token).toBe(TOKEN)
    expect(result.ok && result.value.installation).toEqual({ installationId: 'abc', paired: true })
  })

  it('un token sin instalación emparejada no se usa', async () => {
    const { env } = createTestEnv({
      local: { installation: { installationId: 'abc', paired: false }, pairing: { token: TOKEN } },
    })
    const result = await loadContext(env)
    expect(result.ok && result.value.token).toBeUndefined()
  })

  it('un error de lectura se devuelve tal cual', async () => {
    const { env } = createTestEnv({ local: { localData: { ...createEmptyData(), schemaVersion: 2 } } })
    expect(await loadContext(env)).toEqual(err({ code: 'internal', hint: 'local_data_newer' }))
  })
})
