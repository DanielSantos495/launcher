import { createEmptyData, err, ok, type Bindings, type LauncherData } from '@account-launcher/core'
import { describe, expect, it } from 'vitest'
import { createLocalStore } from '../../src/storage/local-store'
import type { Snapshot } from '../../src/storage/data-store'
import { createTestEnv } from '../helpers/env'

const AT = '2026-10-01T10:00:00.000Z'

function dataWithRevision(revision: number): LauncherData {
  return {
    ...createEmptyData(),
    revision,
    identities: [{ id: 'ana', label: 'Ana', color: '#336699', order: 0, createdAt: AT, updatedAt: AT }],
  }
}

function dataWithAccount(url: string): LauncherData {
  return {
    ...dataWithRevision(1),
    accounts: [
      {
        id: 'acc',
        identityId: 'ana',
        groupId: null,
        serviceId: 'generic',
        label: 'Web',
        url,
        icon: { type: 'auto' },
        favorite: false,
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
  }
}

describe('createLocalStore.read', () => {
  it('con el almacenamiento vacío devuelve datos vacíos y vínculos vacíos sin escribir', async () => {
    const { deps, local } = createTestEnv()
    const store = createLocalStore(deps)
    expect(store.source).toBe('local')
    const result = await store.read()
    expect(result).toEqual(ok({ data: createEmptyData(), bindings: {} }))
    expect(local.calls.set).toBe(0)
  })

  it('devuelve los datos guardados válidos', async () => {
    const data = dataWithRevision(7)
    const bindings: Bindings = { ana: { kind: 'current' } }
    const { deps } = createTestEnv({ local: { localData: data, localBindings: bindings } })
    const result = await createLocalStore(deps).read()
    expect(result).toEqual(ok({ data, bindings }))
  })

  it('una versión de esquema más nueva es local_data_newer', async () => {
    const { deps } = createTestEnv({ local: { localData: { ...createEmptyData(), schemaVersion: 2 } } })
    await expect(createLocalStore(deps).read()).resolves.toEqual(err({ code: 'internal', hint: 'local_data_newer' }))
  })

  it('una cuenta con URL javascript: es local_data_invalid', async () => {
    const { deps } = createTestEnv({ local: { localData: dataWithAccount('javascript:alert(1)') } })
    await expect(createLocalStore(deps).read()).resolves.toEqual(err({ code: 'internal', hint: 'local_data_invalid' }))
  })

  it('datos que no son un objeto de datos son local_data_invalid', async () => {
    const { deps } = createTestEnv({ local: { localData: 'texto' } })
    await expect(createLocalStore(deps).read()).resolves.toEqual(err({ code: 'internal', hint: 'local_data_invalid' }))
  })

  it('vínculos con la clave __proto__ son local_bindings_invalid', async () => {
    // JSON.parse crea __proto__ como clave propia, no como prototipo.
    const hostile: unknown = JSON.parse('{"__proto__":{"kind":"current"}}')
    const { deps } = createTestEnv({ local: { localBindings: hostile } })
    await expect(createLocalStore(deps).read()).resolves.toEqual(
      err({ code: 'internal', hint: 'local_bindings_invalid' }),
    )
  })

  it('vínculos con una forma inválida son local_bindings_invalid', async () => {
    const { deps } = createTestEnv({ local: { localBindings: { ana: { kind: 'chromium-profile' } } } })
    await expect(createLocalStore(deps).read()).resolves.toEqual(
      err({ code: 'internal', hint: 'local_bindings_invalid' }),
    )
  })

  it('datos dañados no se sobrescriben', async () => {
    const { deps, local } = createTestEnv({ local: { localData: dataWithAccount('javascript:alert(1)') } })
    await createLocalStore(deps).read()
    expect(local.calls.set).toBe(0)
  })
})

describe('createLocalStore.write', () => {
  const next = (snapshot: Snapshot): Snapshot => ({
    data: { ...snapshot.data, revision: snapshot.data.revision + 1 },
    bindings: { ana: { kind: 'current' } },
  })

  it('llama a beforeCommit con la instantánea anterior antes del set y hace un solo set', async () => {
    const before = dataWithRevision(4)
    const { deps, local } = createTestEnv({ local: { localData: before, localBindings: {} } })
    const order: string[] = []
    const stop = local.onChange(() => order.push('set'))
    const seen: Snapshot[] = []
    const result = await createLocalStore(deps).write((current) => ok({ next: next(current), value: 'valor' }), {
      beforeCommit: (current) => {
        order.push('beforeCommit')
        seen.push(current)
        return Promise.resolve()
      },
    })
    stop()
    expect(order).toEqual(['beforeCommit', 'set'])
    expect(seen).toEqual([{ data: before, bindings: {} }])
    expect(local.calls.set).toBe(1)
    expect(local.dump()).toEqual({
      localData: { ...before, revision: 5 },
      localBindings: { ana: { kind: 'current' } },
    })
    expect(result).toEqual(
      ok({ snapshot: { data: { ...before, revision: 5 }, bindings: { ana: { kind: 'current' } } }, value: 'valor' }),
    )
  })

  it('con un almacenamiento vacío parte de los datos vacíos', async () => {
    const { deps, local } = createTestEnv()
    const result = await createLocalStore(deps).write((current) => ok({ next: next(current), value: null }))
    expect(result.ok).toBe(true)
    expect(local.dump()).toEqual({
      localData: { ...createEmptyData(), revision: 1 },
      localBindings: { ana: { kind: 'current' } },
    })
  })

  it('si change devuelve un error, no escribe ni llama a beforeCommit', async () => {
    const { deps, local } = createTestEnv({ local: { localData: dataWithRevision(2) } })
    let called = false
    const result = await createLocalStore(deps).write(() => err({ code: 'not_found' }), {
      beforeCommit: () => {
        called = true
        return Promise.resolve()
      },
    })
    expect(result).toEqual(err({ code: 'not_found' }))
    expect(local.calls.set).toBe(0)
    expect(called).toBe(false)
  })

  it('si la lectura falla, devuelve ese error sin llamar a change', async () => {
    const { deps, local } = createTestEnv({ local: { localData: { ...createEmptyData(), schemaVersion: 2 } } })
    let called = false
    const result = await createLocalStore(deps).write((current) => {
      called = true
      return ok({ next: current, value: null })
    })
    expect(result).toEqual(err({ code: 'internal', hint: 'local_data_newer' }))
    expect(called).toBe(false)
    expect(local.calls.set).toBe(0)
  })

  it('si set rechaza, devuelve storage_write y los datos anteriores siguen ahí', async () => {
    const before = dataWithRevision(3)
    const { deps, local } = createTestEnv({ local: { localData: before, localBindings: {} } })
    const store = createLocalStore(deps)
    local.failNextSet()
    const result = await store.write((current) => ok({ next: next(current), value: null }))
    expect(result).toEqual(err({ code: 'internal', hint: 'storage_write' }))
    await expect(store.read()).resolves.toEqual(ok({ data: before, bindings: {} }))
  })

  it('si beforeCommit rechaza, no escribe y la excepción llega a quien llama', async () => {
    const { deps, local } = createTestEnv({ local: { localData: dataWithRevision(1) } })
    const failure = new Error('copia')
    await expect(
      createLocalStore(deps).write((current) => ok({ next: next(current), value: null }), {
        beforeCommit: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure)
    expect(local.calls.set).toBe(0)
  })
})
