import type { LauncherData, Op } from '@account-launcher/core'
import { afterEach, describe, expect, it } from 'vitest'
import { splitModeChange } from '../../src/background/mode'
import { BackupSchema } from '../../src/storage/backup'
import * as v from 'valibot'
import { createTestEnv, DEFAULT_NOW, type TestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost } from '../helpers/fake-host'
import {
  dataWith,
  hostData,
  identity,
  pairedLocal,
  registerInstallation,
  TOKEN_A,
  unpairedLocal,
} from '../helpers/shared-setup'

const putIdentity = (id: string): Op => ({ type: 'identity.put', identity: identity(id) })
const setSettings = (settings: Record<string, unknown>) => ({ type: 'settings.set', settings })

describe('splitModeChange', () => {
  it('quita el modo de settings.set, conserva el resto y los demás tipos', () => {
    const rest: Op = putIdentity('ana')
    const result = splitModeChange([{ type: 'settings.set', settings: { mode: 'single', language: 'en' } }, rest])
    expect(result).toStrictEqual({
      mode: 'single',
      rest: [{ type: 'settings.set', settings: { language: 'en' } }, rest],
    })
  })

  it('un settings.set con solo el modo desaparece de rest', () => {
    const result = splitModeChange([{ type: 'settings.set', settings: { mode: 'multi' } }, putIdentity('ana')])
    expect(result).toStrictEqual({ mode: 'multi', rest: [putIdentity('ana')] })
  })

  it('con dos cambios de modo gana el último', () => {
    const result = splitModeChange([
      { type: 'settings.set', settings: { mode: 'multi' } },
      { type: 'settings.set', settings: { mode: 'single', theme: 'dark' } },
    ])
    expect(result).toStrictEqual({ mode: 'single', rest: [{ type: 'settings.set', settings: { theme: 'dark' } }] })
  })

  it('sin cambios de modo, mode está ausente y rest es igual a la entrada', () => {
    const input: Op[] = [putIdentity('ana'), { type: 'settings.set', settings: { language: 'es' } }]
    const result = splitModeChange(input)
    expect(result).toStrictEqual({ rest: input })
    expect(Object.hasOwn(result, 'mode')).toBe(false)
  })

  it('un settings.set vacío que ya venía vacío se conserva', () => {
    const input: Op[] = [{ type: 'settings.set', settings: {} }]
    expect(splitModeChange(input)).toStrictEqual({ rest: input })
  })

  it('un modo explícitamente indefinido no cuenta como cambio', () => {
    const result = splitModeChange([{ type: 'settings.set', settings: { mode: undefined, language: 'en' } }])
    expect(result).toStrictEqual({ rest: [{ type: 'settings.set', settings: { language: 'en' } }] })
  })

  it('no modifica la entrada', () => {
    const input: Op[] = [{ type: 'settings.set', settings: { mode: 'single', language: 'en' } }]
    splitModeChange(input)
    expect(input).toStrictEqual([{ type: 'settings.set', settings: { mode: 'single', language: 'en' } }])
  })
})

let current: FakeHost | undefined

afterEach(() => {
  expect(current?.invalidRequests ?? 0).toBe(0)
  current = undefined
})

// A, en "Varios perfiles" y con dos cambios ya hechos en los datos compartidos (revisión 3) mientras los locales
// siguen en la revisión 1.
async function pairedA(): Promise<{ fake: FakeHost; a: TestEnv; localBefore: LauncherData }> {
  const fake = createFakeHost()
  current = fake
  const localBefore = dataWith('multi', ['ana'])
  const a = createTestEnv({ host: fake, local: unpairedLocal('inst-a', localBefore) })
  expect(await a.route({ type: 'pair.start' })).toMatchObject({ ok: true })
  await a.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('bea')] })
  await a.route({ type: 'data.mutate', revision: 0, ops: [putIdentity('cris')] })
  return { fake, a, localBefore }
}

function storedData(t: TestEnv): unknown {
  return t.local.dump().localData
}

describe('cambio de modo con la instalación emparejada (DC2)', () => {
  it('de multi a single copia los datos compartidos a los locales, tras guardar una copia de los locales', async () => {
    const { fake, a, localBefore } = await pairedA()
    const shared = hostData(fake)
    expect(shared.revision).toBe(3)
    const requestsBefore = fake.requests.length

    const response = await a.route({ type: 'data.mutate', revision: 0, ops: [setSettings({ mode: 'single' })] })
    expect(response).toEqual({ ok: true, result: { revision: localBefore.revision + 1 } })

    const expected = {
      ...shared,
      settings: { ...shared.settings, mode: 'single' },
      revision: localBefore.revision + 1,
    }
    expect(storedData(a)).toEqual(expected)
    const backup = v.safeParse(BackupSchema, a.local.dump().backup)
    expect(backup.success).toBe(true)
    expect(a.local.dump().backup).toEqual({ createdAt: DEFAULT_NOW, source: 'local', data: localBefore, bindings: {} })

    expect(await a.route({ type: 'data.get' })).toEqual({ ok: true, result: { data: expected, source: 'local' } })
    // DC2 no llama al host: la copia sale de la caché y en "Perfil único" el host no se usa.
    expect(fake.requests.length).toBe(requestsBefore)
  })

  it('copia también los vínculos compartidos', async () => {
    const { fake, a } = await pairedA()
    expect(await a.route({ type: 'bindings.set', identityId: 'ana', binding: { kind: 'current' } })).toEqual({
      ok: true,
      result: {},
    })
    await a.route({ type: 'data.mutate', revision: 0, ops: [setSettings({ mode: 'single' })] })
    expect(a.local.dump().localBindings).toEqual({ ana: { kind: 'current' } })
    expect(fake.state.store?.bindings).toEqual({ ana: { kind: 'current' } })
  })

  it('con otras operaciones en el mismo mensaje, primero se escriben en el host y luego se copian', async () => {
    const { fake, a } = await pairedA()
    const response = await a.route({
      type: 'data.mutate',
      revision: 0,
      ops: [putIdentity('dani'), setSettings({ mode: 'single', language: 'en' })],
    })
    expect(response).toMatchObject({ ok: true })
    const shared = hostData(fake)
    expect(shared.identities.map((i) => i.id)).toEqual(['ana', 'bea', 'cris', 'dani'])
    expect(shared.settings.language).toBe('en')
    // El modo no viaja al host.
    expect(shared.settings.mode).toBe('multi')
    expect(storedData(a)).toMatchObject({ identities: shared.identities, settings: { mode: 'single', language: 'en' } })
  })

  it('si las otras operaciones fallan no cambia el modo ni se toca lo local', async () => {
    const { a, localBefore } = await pairedA()
    const orphan = {
      id: 'acc',
      identityId: 'fantasma',
      groupId: null,
      serviceId: 'github',
      label: 'GitHub',
      icon: { type: 'auto' },
      favorite: false,
      order: 0,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    }
    const response = await a.route({
      type: 'data.mutate',
      revision: 0,
      ops: [{ type: 'account.put', account: orphan }, setSettings({ mode: 'single' })],
    })
    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'op_invalid' } })
    expect(storedData(a)).toEqual(localBefore)
    expect(Object.keys(a.local.dump())).not.toContain('backup')
  })

  it('con el host en missing y sin caché pasa a single y conserva los datos locales', async () => {
    const fake = createFakeHost()
    current = fake
    registerInstallation(fake, 'inst-a', TOKEN_A)
    fake.state.store = { revision: 5, data: dataWith('multi', ['otra']), bindings: {} }
    const before = dataWith('multi', ['ana'])
    const a = createTestEnv({ host: fake, local: pairedLocal('inst-a', TOKEN_A, before) })
    fake.mode = 'missing'

    const response = await a.route({ type: 'data.mutate', revision: 0, ops: [setSettings({ mode: 'single' })] })
    expect(response).toEqual({ ok: true, result: { revision: before.revision + 1 } })
    expect(storedData(a)).toEqual({
      ...before,
      settings: { ...before.settings, mode: 'single' },
      revision: before.revision + 1,
    })
    expect(Object.keys(a.local.dump())).not.toContain('backup')
    expect(await a.route({ type: 'data.get' })).toMatchObject({ ok: true, result: { source: 'local' } })
  })

  it('un cambio de modo que no cambia nada (ya es multi) devuelve la revisión compartida', async () => {
    const { fake, a, localBefore } = await pairedA()
    const requestsBefore = fake.requests.length
    const response = await a.route({ type: 'data.mutate', revision: 0, ops: [setSettings({ mode: 'multi' })] })
    expect(response).toEqual({ ok: true, result: { revision: 3 } })
    expect(storedData(a)).toEqual(localBefore)
    expect(fake.requests.length).toBe(requestsBefore)
  })
})

describe('cambio de modo a "Varios perfiles"', () => {
  it('de single a multi con la instalación emparejada vuelve a leer lo compartido sin tocar los datos locales', async () => {
    const { fake, a } = await pairedA()
    await a.route({ type: 'data.mutate', revision: 0, ops: [setSettings({ mode: 'single' })] })
    const localSingle = storedData(a) as LauncherData
    expect(localSingle.settings.mode).toBe('single')

    const response = await a.route({ type: 'data.mutate', revision: 0, ops: [setSettings({ mode: 'multi' })] })
    expect(response).toEqual({ ok: true, result: { revision: localSingle.revision + 1 } })
    expect(storedData(a)).toEqual({
      ...localSingle,
      settings: { ...localSingle.settings, mode: 'multi' },
      revision: localSingle.revision + 1,
    })

    const got = await a.route({ type: 'data.get' })
    const shared = hostData(fake)
    expect(got).toEqual({
      ok: true,
      result: { data: { ...shared, settings: { ...shared.settings, mode: 'multi' } }, source: 'shared' },
    })
  })

  it('una instalación sin emparejar sigue leyendo lo local tras pasar a multi', async () => {
    const fake = createFakeHost()
    current = fake
    const a = createTestEnv({ host: fake, local: unpairedLocal('inst-a', dataWith('single', ['ana'])) })
    await a.route({ type: 'data.mutate', revision: 0, ops: [setSettings({ mode: 'multi' })] })
    expect(await a.route({ type: 'data.get' })).toMatchObject({ ok: true, result: { source: 'local' } })
    expect(fake.requests).toEqual([])
  })
})

describe('ajustes compartidos y modo efectivo', () => {
  it('en shared, settings.set de idioma va al host (DC10) y los datos locales no cambian', async () => {
    const { fake, a, localBefore } = await pairedA()
    const response = await a.route({ type: 'data.mutate', revision: 0, ops: [setSettings({ language: 'en' })] })
    expect(response).toEqual({ ok: true, result: { revision: 4 } })
    expect(hostData(fake).settings.language).toBe('en')
    expect(storedData(a)).toEqual(localBefore)
  })

  it('el modo guardado en los datos compartidos se ignora: manda el de los datos locales (DC1)', async () => {
    const fake = createFakeHost()
    current = fake
    registerInstallation(fake, 'inst-a', TOKEN_A)
    fake.state.store = { revision: 2, data: dataWith('single', ['ana']), bindings: {} }
    const a = createTestEnv({ host: fake, local: pairedLocal('inst-a', TOKEN_A, dataWith('multi')) })
    const got = await a.route({ type: 'data.get' })
    expect(got).toEqual({ ok: true, result: { data: dataWith('multi', ['ana']), source: 'shared' } })
    expect(hostData(fake).settings.mode).toBe('single')
  })
})
