import {
  applyOps,
  createEmptyData,
  err,
  loadData,
  ok,
  type Bindings,
  type LauncherData,
  type Op,
} from '@account-launcher/core'
import { MAX_SHARED_BINDINGS_BYTES, MAX_SHARED_DATA_BYTES } from '@account-launcher/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uiError } from '../../src/background/hints'
import type { Snapshot } from '../../src/storage/data-store'
import { createLocalStore } from '../../src/storage/local-store'
import { createSharedStore, type SharedStore } from '../../src/storage/shared-store'
import { jsonBytes } from '../../src/storage/usage'
import { dataOfBytes } from '../helpers/data-of-bytes'
import { createTestEnv, DEFAULT_NOW, type TestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost } from '../helpers/fake-host'
import {
  AT,
  dataWith,
  identity,
  registerInstallation,
  requestsOf,
  TOKEN_A,
  TOKEN_B,
  unpairedLocal,
} from '../helpers/shared-setup'

interface Setup {
  readonly fake: FakeHost
  readonly t: TestEnv
  readonly store: SharedStore
  readonly onNotPaired: ReturnType<typeof vi.fn<() => Promise<void>>>
}

let current: FakeHost | undefined

afterEach(() => {
  // Ninguna petición del almacén puede salirse del contrato del host.
  expect(current?.invalidRequests ?? 0).toBe(0)
  current = undefined
})

// Almacén compartido de la instalación A, con el host falso ya con A registrada. `shared` es el estado del host.
function setup(shared: { revision: number; data: unknown; bindings: Record<string, unknown> } | undefined): Setup {
  const fake = createFakeHost()
  current = fake
  registerInstallation(fake, 'inst-a', TOKEN_A)
  fake.state.store = shared ?? { revision: 0, data: null, bindings: {} }
  const t = createTestEnv({ host: fake, local: unpairedLocal('inst-a', dataWith('multi', ['ana'])) })
  if (t.env.host === undefined) throw new Error('el entorno de prueba debería tener host')
  const onNotPaired = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const store = createSharedStore({
    deps: t.deps,
    host: t.env.host,
    token: TOKEN_A,
    local: createLocalStore(t.deps),
    onNotPaired,
  })
  return { fake, t, store, onNotPaired }
}

// Segundo almacén sobre el mismo host (otra instalación, con su propia sesión).
function otherStore(fake: FakeHost, token: string): SharedStore {
  const t = createTestEnv({ host: fake, local: unpairedLocal('inst-b', dataWith('multi')) })
  if (t.env.host === undefined) throw new Error('el entorno de prueba debería tener host')
  return createSharedStore({
    deps: t.deps,
    host: t.env.host,
    token,
    local: createLocalStore(t.deps),
    onNotPaired: () => Promise.resolve(),
  })
}

const ops = (...list: Op[]) => list
const putIdentity = (id: string): Op => ({ type: 'identity.put', identity: identity(id) })

// Cambio puro que aplica operaciones sobre la base.
function applying(list: readonly Op[], spy?: () => void) {
  return (base: Snapshot) => {
    spy?.()
    const applied = applyOps(base.data, list)
    if (!applied.ok) return err(uiError('invalid', 'op_invalid'))
    return ok({ next: { data: applied.value, bindings: base.bindings }, value: applied.value.revision })
  }
}

function snapshotOf(data: LauncherData, bindings: Bindings = {}): Snapshot {
  return { data, bindings }
}

describe('SharedStore.refresh', () => {
  it('con el almacén recién creado (data null) siembra con los datos locales', async () => {
    const { fake, store, t } = setup(undefined)
    const refreshed = await store.refresh()
    expect(refreshed).toEqual(
      ok({ hostRevision: 1, data: dataWith('multi', ['ana']), bindings: {}, fetchedAt: DEFAULT_NOW }),
    )
    expect(fake.state.store).toEqual({ revision: 1, data: dataWith('multi', ['ana']), bindings: {} })
    // La caché de la sesión queda con la revisión sembrada.
    expect(t.session.dump().shared).toMatchObject({ hostRevision: 1 })
  })

  it('siembra también los vínculos locales', async () => {
    const { fake, t, store } = setup(undefined)
    await t.local.set({ localBindings: { ana: { kind: 'current' } } })
    expect((await store.refresh()).ok).toBe(true)
    expect(fake.state.store?.bindings).toEqual({ ana: { kind: 'current' } })
  })

  it('si otra instalación sembró antes (conflict), repite y se queda con lo que hay', async () => {
    const { fake, store } = setup(undefined)
    const theirs = dataWith('multi', ['bea'])
    fake.override = ({ cmd }) => {
      if (cmd !== 'sync.put') return undefined
      fake.override = undefined
      fake.state.store = { revision: 1, data: theirs, bindings: {} }
      return { ok: false, error: { code: 'conflict', revision: 1 } }
    }
    const refreshed = await store.refresh()
    expect(refreshed.ok && refreshed.value.data).toEqual(theirs)
    expect(refreshed.ok && refreshed.value.hostRevision).toBe(1)
    expect(requestsOf(fake, 'sync.put')).toBe(1)
    expect(requestsOf(fake, 'sync.get')).toBe(2)
  })

  it('si el conflict de la siembra se repite, devuelve conflict (una sola repetición)', async () => {
    const { fake, store } = setup(undefined)
    fake.override = ({ cmd }) =>
      cmd === 'sync.put' ? { ok: false, error: { code: 'conflict', revision: 7 } } : undefined
    expect(await store.refresh()).toEqual(err({ code: 'conflict' }))
    expect(requestsOf(fake, 'sync.put')).toBe(2)
  })

  it('too_large del host al sembrar es shared_data_full', async () => {
    const { fake, store } = setup(undefined)
    fake.override = ({ cmd }) => (cmd === 'sync.put' ? { ok: false, error: { code: 'too_large' } } : undefined)
    expect(await store.refresh()).toEqual(err({ code: 'too_large', hint: 'shared_data_full' }))
  })

  it('un error de lectura de los datos locales al sembrar se devuelve y no escribe en el host', async () => {
    const { fake, t, store } = setup(undefined)
    await t.local.set({ localData: { ...createEmptyData(), schemaVersion: 2 } })
    expect(await store.refresh()).toEqual(err({ code: 'internal', hint: 'local_data_newer' }))
    expect(requestsOf(fake, 'sync.put')).toBe(0)
  })

  it('otro error del host al sembrar se devuelve sin la revisión', async () => {
    const { fake, store } = setup(undefined)
    fake.override = ({ cmd }) => (cmd === 'sync.put' ? { ok: false, error: { code: 'internal' } } : undefined)
    expect(await store.refresh()).toEqual(err({ code: 'internal' }))
  })

  it('un not_paired al sembrar llama a onNotPaired', async () => {
    const { fake, store, onNotPaired } = setup(undefined)
    fake.override = ({ cmd }) => (cmd === 'sync.put' ? { ok: false, error: { code: 'not_paired' } } : undefined)
    expect(await store.refresh()).toEqual(err({ code: 'not_paired' }))
    expect(onNotPaired).toHaveBeenCalledTimes(1)
  })

  it('datos de una versión más nueva: shared_data_newer y nada se escribe en el host', async () => {
    const newer = { ...createEmptyData(), schemaVersion: 2 }
    const { fake, store } = setup({ revision: 3, data: newer, bindings: {} })
    expect(await store.refresh()).toEqual(err({ code: 'invalid', hint: 'shared_data_newer' }))
    // Un write posterior devuelve el mismo error sin llamar a change ni a sync.put (Review Focus 3).
    const change = vi.fn(applying(ops(putIdentity('x'))))
    expect(await store.write(change)).toEqual(err({ code: 'invalid', hint: 'shared_data_newer' }))
    expect(change).not.toHaveBeenCalled()
    expect(requestsOf(fake, 'sync.put')).toBe(0)
    expect(fake.state.store).toEqual({ revision: 3, data: newer, bindings: {} })
  })

  it('datos que no validan: shared_data_invalid', async () => {
    const { fake, store } = setup({ revision: 3, data: { ...createEmptyData(), identities: 'x' }, bindings: {} })
    expect(await store.refresh()).toEqual(err({ code: 'invalid', hint: 'shared_data_invalid' }))
    expect(requestsOf(fake, 'sync.put')).toBe(0)
  })

  it('vínculos que no validan: shared_bindings_invalid', async () => {
    const bindings = { x: { kind: 'chromium-profile', profileDirectory: '-x' } }
    const { fake, store } = setup({ revision: 3, data: createEmptyData(), bindings })
    expect(await store.refresh()).toEqual(err({ code: 'invalid', hint: 'shared_bindings_invalid' }))
    expect(requestsOf(fake, 'sync.put')).toBe(0)
    expect(fake.state.store?.bindings).toEqual(bindings)
  })

  it('un host sin respuesta se devuelve tal cual', async () => {
    const { fake, store } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
    fake.mode = 'missing'
    expect(await store.refresh()).toEqual(err({ code: 'host_missing' }))
  })

  it('not_paired: llama una vez a onNotPaired y devuelve not_paired', async () => {
    const { fake, store, onNotPaired } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
    fake.state.installations.splice(0)
    expect(await store.refresh()).toEqual(err({ code: 'not_paired' }))
    expect(onNotPaired).toHaveBeenCalledTimes(1)
  })

  it('dos refresh sin cambios en el host escriben la sesión una sola vez', async () => {
    const { t, store } = setup({ revision: 4, data: createEmptyData(), bindings: {} })
    await store.refresh()
    await store.refresh()
    expect(t.session.calls.set).toBe(1)
  })

  it('un refresh con otra revisión sí reescribe la caché', async () => {
    const { fake, t, store } = setup({ revision: 4, data: createEmptyData(), bindings: {} })
    await store.refresh()
    fake.state.store = { revision: 5, data: dataWith('multi', ['bea']), bindings: {} }
    const refreshed = await store.refresh()
    expect(refreshed.ok && refreshed.value.hostRevision).toBe(5)
    expect(t.session.calls.set).toBe(2)
    expect(t.session.dump().shared).toMatchObject({ hostRevision: 5 })
  })

  it('un fallo al guardar la caché no es un fallo del refresh', async () => {
    const { t, store } = setup({ revision: 4, data: createEmptyData(), bindings: {} })
    t.session.failNextSet()
    const refreshed = await store.refresh()
    expect(refreshed.ok && refreshed.value.hostRevision).toBe(4)
    expect(t.session.dump()).toEqual({})
  })

  it('datos con una clave __proto__ y sin los campos obligatorios no validan', async () => {
    const hostile = JSON.parse(`{"schemaVersion":1,"__proto__":{"x":1}}`) as unknown
    const { store } = setup({ revision: 2, data: hostile, bindings: {} })
    // Valibot omite __proto__; los campos que faltan hacen que no valide, sin lanzar.
    expect(await store.refresh()).toEqual(err({ code: 'invalid', hint: 'shared_data_invalid' }))
  })
})

describe('SharedStore.read', () => {
  it('dos read seguidos hacen un solo sync.get', async () => {
    const { fake, store } = setup({ revision: 2, data: dataWith('multi', ['ana']), bindings: {} })
    const first = await store.read()
    const second = await store.read()
    expect(first).toEqual(ok(snapshotOf(dataWith('multi', ['ana']))))
    expect(second).toEqual(first)
    expect(requestsOf(fake, 'sync.get')).toBe(1)
  })

  it('devuelve la fuente compartida', () => {
    const { store } = setup(undefined)
    expect(store.source).toBe('shared')
  })

  it.each([
    ['revisión negativa', { hostRevision: -1 }],
    ['campo de más', { extra: 1 }],
    ['datos de otra versión', { data: { ...createEmptyData(), schemaVersion: 2 } }],
    ['datos que no validan', { data: { ...createEmptyData(), identities: 'x' } }],
    ['vínculos que no validan', { bindings: { x: { kind: 'otro' } } }],
    ['fecha no canónica', { fetchedAt: '2026-10-08' }],
    ['sin datos', { data: undefined }],
  ])('una caché con %s se trata como ausente', async (_name, patch) => {
    const { fake, t, store } = setup({ revision: 2, data: dataWith('multi', ['ana']), bindings: {} })
    const cache = { hostRevision: 2, data: dataWith('multi', ['ana']), bindings: {}, fetchedAt: DEFAULT_NOW, ...patch }
    await t.session.set({ shared: cache })
    const snapshot = await store.read()
    expect(snapshot).toEqual(ok(snapshotOf(dataWith('multi', ['ana']))))
    expect(requestsOf(fake, 'sync.get')).toBe(1)
  })

  it('una caché válida de otra sesión se usa sin llamar al host', async () => {
    const { fake, t, store } = setup({ revision: 9, data: createEmptyData(), bindings: {} })
    const cache = { hostRevision: 2, data: dataWith('multi', ['ana']), bindings: {}, fetchedAt: DEFAULT_NOW }
    await t.session.set({ shared: cache })
    expect(await store.read()).toEqual(ok(snapshotOf(dataWith('multi', ['ana']))))
    expect(fake.requests).toEqual([])
  })

  it('el error de refresh se devuelve', async () => {
    const { store } = setup({ revision: 3, data: { ...createEmptyData(), schemaVersion: 2 }, bindings: {} })
    expect(await store.read()).toEqual(err({ code: 'invalid', hint: 'shared_data_newer' }))
  })
})

describe('SharedStore.write', () => {
  it('escribe con la revisión leída, actualiza la caché y devuelve la instantánea', async () => {
    const { fake, t, store } = setup({ revision: 2, data: dataWith('multi', ['ana']), bindings: {} })
    const written = await store.write(applying(ops(putIdentity('bea'))))
    const expected = dataWith('multi', ['ana', 'bea'])
    expect(written.ok && written.value.snapshot).toEqual(snapshotOf({ ...expected, revision: 2 }))
    expect(written.ok && written.value.value).toBe(2)
    expect(fake.state.store?.revision).toBe(3)
    expect(fake.requests.find((request) => request.cmd === 'sync.put')?.args).toMatchObject({ baseRevision: 2 })
    expect(t.session.dump().shared).toMatchObject({ hostRevision: 3 })
    // La lectura siguiente sale de la caché: ya no hay otro sync.get.
    await store.read()
    expect(requestsOf(fake, 'sync.get')).toBe(1)
  })

  it('un fallo al guardar la caché después de escribir no cambia el resultado', async () => {
    const { fake, t, store } = setup({ revision: 2, data: createEmptyData(), bindings: {} })
    await store.read()
    t.session.failNextSet()
    expect((await store.write(applying(ops(putIdentity('bea'))))).ok).toBe(true)
    expect(fake.state.store?.revision).toBe(3)
  })

  it('si falla guardar la caché tras escribir, la caché anterior se borra y no queda una revisión vieja', async () => {
    const { t, store } = setup({ revision: 2, data: createEmptyData(), bindings: {} })
    await store.read()
    expect(t.session.dump().shared).toMatchObject({ hostRevision: 2 })
    t.session.failNextSet()
    expect((await store.write(applying(ops(putIdentity('bea'))))).ok).toBe(true)
    expect(t.session.dump()).toEqual({})
    // La siguiente lectura va al host y ve la revisión nueva.
    const read = await store.read()
    expect(read.ok && read.value.data.identities.map((i) => i.id)).toContain('bea')
  })

  it('con un conflicto reaplica sobre lo último: quedan la cuenta de B y la identidad de A', async () => {
    const base = { ...dataWith('multi', ['base']), revision: 1 }
    const { fake, store } = setup({ revision: 1, data: base, bindings: {} })
    registerInstallation(fake, 'inst-b', TOKEN_B)
    await store.read() // A ya tiene la caché de la revisión 1
    // B escribe entre la lectura de A y su sync.put.
    const b = otherStore(fake, TOKEN_B)
    const account = {
      id: 'acc-b',
      identityId: 'base',
      groupId: null,
      serviceId: 'github',
      label: 'GitHub',
      icon: { type: 'auto' as const },
      favorite: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    }
    expect((await b.write(applying(ops({ type: 'account.put', account })))).ok).toBe(true)

    const calls = vi.fn<(entry: string | number) => void>()
    const before = vi.fn((snapshot: Snapshot) => {
      calls(snapshot.data.accounts.length)
      return Promise.resolve()
    })
    const written = await store.write(
      applying(ops(putIdentity('ana')), () => {
        calls('change')
      }),
      { beforeCommit: before },
    )
    expect(written.ok).toBe(true)
    const final = loadData(fake.state.store?.data)
    expect(final.ok && final.value.accounts.map((a) => a.id)).toEqual(['acc-b'])
    expect(final.ok && final.value.identities.map((i) => i.id)).toEqual(['base', 'ana'])
    // change se llamó dos veces; beforeCommit antes de cada sync.put, con la base de cada intento.
    expect(calls.mock.calls).toEqual([['change'], [0], ['change'], [1]])
  })

  it('un conflicto permanente devuelve conflict tras 3 intentos', async () => {
    const { fake, store } = setup({ revision: 1, data: dataWith('multi', ['base']), bindings: {} })
    fake.override = ({ cmd }) =>
      cmd === 'sync.put' ? { ok: false, error: { code: 'conflict', revision: 9 } } : undefined
    const change = vi.fn(applying(ops(putIdentity('ana'))))
    expect(await store.write(change)).toEqual(err({ code: 'conflict' }))
    expect(change).toHaveBeenCalledTimes(3)
    expect(requestsOf(fake, 'sync.put')).toBe(3)
    // El primer intento usa la caché que dejó read(); los otros dos piden la última versión.
    expect(requestsOf(fake, 'sync.get')).toBe(3)
  })

  it('un error de change se devuelve sin llamar al host', async () => {
    const { fake, store } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
    const before = vi.fn(() => Promise.resolve())
    const result = await store.write(() => err(uiError('not_found')), { beforeCommit: before })
    expect(result).toEqual(err({ code: 'not_found' }))
    expect(before).not.toHaveBeenCalled()
    expect(requestsOf(fake, 'sync.put')).toBe(0)
  })

  it('si no se puede leer la base, devuelve ese error sin llamar a change', async () => {
    const { fake, store } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
    fake.mode = 'exit'
    const change = vi.fn(applying(ops(putIdentity('ana'))))
    expect(await store.write(change)).toEqual(err({ code: 'host_error', hint: 'host_failed' }))
    expect(change).not.toHaveBeenCalled()
  })

  describe('frontera de tamaño', () => {
    it('MAX_SHARED_DATA_BYTES se envía y se acepta', async () => {
      const { fake, store } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
      const big = dataOfBytes(MAX_SHARED_DATA_BYTES)
      expect(jsonBytes(big)).toBe(MAX_SHARED_DATA_BYTES)
      const written = await store.write(() => ok({ next: snapshotOf(big), value: undefined }))
      expect(written.ok).toBe(true)
      expect(requestsOf(fake, 'sync.put')).toBe(1)
      expect(fake.state.store?.revision).toBe(2)
      expect(fake.state.store?.data).toEqual(big)
    })

    it('MAX_SHARED_DATA_BYTES + 1 es shared_data_full y no se envía nada', async () => {
      const { fake, store } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
      const before = vi.fn(() => Promise.resolve())
      const big = dataOfBytes(MAX_SHARED_DATA_BYTES + 1)
      const written = await store.write(() => ok({ next: snapshotOf(big), value: undefined }), { beforeCommit: before })
      expect(written).toEqual(err({ code: 'too_large', hint: 'shared_data_full' }))
      expect(requestsOf(fake, 'sync.put')).toBe(0)
      expect(before).not.toHaveBeenCalled()
      expect(fake.state.store?.revision).toBe(1)
    })

    it('vínculos de MAX_SHARED_BINDINGS_BYTES + 1 son shared_bindings_full y no se envía nada', async () => {
      const { fake, store } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
      // {"a":{"kind":"current","pad":"..."}} con el relleno justo para pasarse un byte del límite.
      const empty = jsonBytes({ a: { kind: 'chromium-profile', profileDirectory: '' } })
      const bindings = {
        a: { kind: 'chromium-profile' as const, profileDirectory: 'x'.repeat(MAX_SHARED_BINDINGS_BYTES + 1 - empty) },
      }
      expect(jsonBytes(bindings)).toBe(MAX_SHARED_BINDINGS_BYTES + 1)
      const written = await store.write(() => ok({ next: snapshotOf(createEmptyData(), bindings), value: undefined }))
      expect(written).toEqual(err({ code: 'too_large', hint: 'shared_bindings_full' }))
      expect(requestsOf(fake, 'sync.put')).toBe(0)
    })

    it('vínculos de exactamente MAX_SHARED_BINDINGS_BYTES pasan la comprobación de tamaño', async () => {
      const { fake, store } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
      const empty = jsonBytes({ a: { kind: 'chromium-profile', profileDirectory: '' } })
      const bindings = {
        a: { kind: 'chromium-profile' as const, profileDirectory: 'x'.repeat(MAX_SHARED_BINDINGS_BYTES - empty) },
      }
      expect(jsonBytes(bindings)).toBe(MAX_SHARED_BINDINGS_BYTES)
      // No es shared_bindings_full: el tamaño es válido y el cliente del host rechaza el esquema (carpeta de más de
      // 255 caracteres) antes de enviar nada.
      const written = await store.write(() => ok({ next: snapshotOf(createEmptyData(), bindings), value: undefined }))
      expect(written).toEqual(err({ code: 'internal', hint: 'bad_host_request' }))
      expect(requestsOf(fake, 'sync.put')).toBe(0)
    })

    it('too_large del host es shared_data_full', async () => {
      const { fake, store } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
      fake.override = ({ cmd }) => (cmd === 'sync.put' ? { ok: false, error: { code: 'too_large' } } : undefined)
      expect(await store.write(applying(ops(putIdentity('ana'))))).toEqual(
        err({ code: 'too_large', hint: 'shared_data_full' }),
      )
    })
  })

  describe('not_paired', () => {
    it('al escribir llama una vez a onNotPaired y devuelve not_paired', async () => {
      const { fake, store, onNotPaired } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
      await store.read()
      fake.state.installations.splice(0) // otra instalación revocó a A
      expect(await store.write(applying(ops(putIdentity('ana'))))).toEqual(err({ code: 'not_paired' }))
      expect(onNotPaired).toHaveBeenCalledTimes(1)
    })

    it('al leer la base llama una vez a onNotPaired', async () => {
      const { fake, store, onNotPaired } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
      fake.state.installations.splice(0)
      expect(await store.write(applying(ops(putIdentity('ana'))))).toEqual(err({ code: 'not_paired' }))
      expect(onNotPaired).toHaveBeenCalledTimes(1)
    })
  })

  it('otro error del host al escribir se devuelve tal cual', async () => {
    const { fake, store } = setup({ revision: 1, data: createEmptyData(), bindings: {} })
    fake.override = ({ cmd }) => (cmd === 'sync.put' ? { ok: false, error: { code: 'internal' } } : undefined)
    expect(await store.write(applying(ops(putIdentity('ana'))))).toEqual(err({ code: 'internal' }))
  })
})

describe('dataOfBytes', () => {
  it.each([5_000, 100_000, MAX_SHARED_DATA_BYTES])('produce datos válidos de %i bytes', (bytes) => {
    const data = dataOfBytes(bytes)
    expect(jsonBytes(data)).toBe(bytes)
    expect(loadData(data).ok).toBe(true)
  })

  it('lanza si el tamaño es menor que el mínimo', () => {
    expect(() => dataOfBytes(10)).toThrow()
  })
})
