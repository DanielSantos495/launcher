import { describe, expect, it } from 'vitest'
import {
  clearPairing,
  ensureInstallation,
  readToken,
  saveInstallation,
  savePairing,
} from '../../src/storage/installation'
import { createTestEnv } from '../helpers/env'

const TOKEN = 'A'.repeat(43)

describe('ensureInstallation', () => {
  it('con el almacenamiento vacío crea y guarda una instalación; la segunda llamada devuelve la misma', async () => {
    const { deps, local } = createTestEnv()
    const first = await ensureInstallation(deps)
    expect(first).toEqual({ installationId: 'id-1', paired: false })
    expect(local.dump()).toEqual({ installation: { installationId: 'id-1', paired: false } })
    const second = await ensureInstallation(deps)
    expect(second).toEqual({ installationId: 'id-1', paired: false })
    // randomId solo se llamó una vez: la siguiente id sería id-2.
    expect(deps.randomId()).toBe('id-2')
  })

  it('una instalación con un campo de más no vale: se crea otra y desaparece el token', async () => {
    const { deps, local } = createTestEnv({
      local: {
        installation: { installationId: 'x', paired: true, extra: 1 },
        pairing: { token: TOKEN },
      },
    })
    const installation = await ensureInstallation(deps)
    expect(installation).toEqual({ installationId: 'id-1', paired: false })
    expect(local.dump()).toEqual({ installation: { installationId: 'id-1', paired: false } })
  })

  it('conserva los campos opcionales válidos', async () => {
    const stored = { installationId: 'abc', paired: true, ownIdentityId: 'ana', ownProfileDirectory: 'Profile 1' }
    const { deps } = createTestEnv({ local: { installation: stored } })
    await expect(ensureInstallation(deps)).resolves.toEqual(stored)
  })

  it.each([
    ['id con prototipo', { installationId: '__proto__', paired: false }],
    ['paired no booleano', { installationId: 'x', paired: 'yes' }],
    ['carpeta de perfil con ruta', { installationId: 'x', paired: false, ownProfileDirectory: '../x' }],
  ])('%s: se sustituye', async (_name, bad) => {
    const { deps } = createTestEnv({ local: { installation: bad } })
    await expect(ensureInstallation(deps)).resolves.toEqual({ installationId: 'id-1', paired: false })
  })
})

describe('readToken', () => {
  it('con paired true y un token válido de 43 caracteres devuelve el token', async () => {
    const { deps } = createTestEnv({ local: { pairing: { token: TOKEN } } })
    await expect(readToken(deps, { installationId: 'x', paired: true })).resolves.toBe(TOKEN)
  })

  it('con paired false no cuenta aunque haya token', async () => {
    const { deps } = createTestEnv({ local: { pairing: { token: TOKEN } } })
    await expect(readToken(deps, { installationId: 'x', paired: false })).resolves.toBeUndefined()
  })

  it('un token de 42 caracteres no vale', async () => {
    const { deps } = createTestEnv({ local: { pairing: { token: 'A'.repeat(42) } } })
    await expect(readToken(deps, { installationId: 'x', paired: true })).resolves.toBeUndefined()
  })

  it('un token con un carácter fuera del alfabeto no vale', async () => {
    const { deps } = createTestEnv({ local: { pairing: { token: `${'A'.repeat(42)}=` } } })
    await expect(readToken(deps, { installationId: 'x', paired: true })).resolves.toBeUndefined()
  })

  it('pairing con un campo de más no vale', async () => {
    const { deps } = createTestEnv({ local: { pairing: { token: TOKEN, extra: 1 } } })
    await expect(readToken(deps, { installationId: 'x', paired: true })).resolves.toBeUndefined()
  })

  it('sin pairing devuelve undefined', async () => {
    const { deps } = createTestEnv()
    await expect(readToken(deps, { installationId: 'x', paired: true })).resolves.toBeUndefined()
  })
})

describe('savePairing', () => {
  it('guarda installation y pairing en un solo set', async () => {
    const { deps, local } = createTestEnv()
    const installation = await ensureInstallation(deps)
    const before = local.calls.set
    const paired = await savePairing(deps, installation, TOKEN)
    expect(paired).toEqual({ installationId: 'id-1', paired: true })
    expect(local.calls.set - before).toBe(1)
    expect(local.dump()).toEqual({
      installation: { installationId: 'id-1', paired: true },
      pairing: { token: TOKEN },
    })
    await expect(readToken(deps, paired)).resolves.toBe(TOKEN)
  })

  it('conserva los campos propios de la instalación', async () => {
    const { deps, local } = createTestEnv()
    const installation = { installationId: 'abc', paired: false, ownIdentityId: 'ana', ownProfileDirectory: 'Default' }
    await savePairing(deps, installation, TOKEN)
    expect(local.dump().installation).toEqual({ ...installation, paired: true })
  })
})

describe('clearPairing', () => {
  it('borra pairing, borra shared de la sesión y deja paired en false', async () => {
    const { deps, local, session } = createTestEnv()
    const installation = await savePairing(deps, { installationId: 'abc', paired: false }, TOKEN)
    await deps.session.set({ shared: { revision: 3 } })
    const cleared = await clearPairing(deps, installation)
    expect(cleared).toEqual({ installationId: 'abc', paired: false })
    expect(local.dump()).toEqual({ installation: { installationId: 'abc', paired: false } })
    expect(session.dump()).toEqual({})
    await expect(readToken(deps, cleared)).resolves.toBeUndefined()
  })
})

describe('saveInstallation', () => {
  it('guarda la instalación tal cual', async () => {
    const { deps, local } = createTestEnv()
    await saveInstallation(deps, { installationId: 'abc', paired: false, ownProfileDirectory: 'Default' })
    expect(local.dump()).toEqual({
      installation: { installationId: 'abc', paired: false, ownProfileDirectory: 'Default' },
    })
  })
})
