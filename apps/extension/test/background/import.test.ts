import {
  createEmptyData,
  LIMITS,
  type Account,
  type BindingHint,
  type Bindings,
  type Identity,
  type LauncherData,
  type ProfileInfo,
} from '@account-launcher/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildExport, readImportText } from '../../src/ui/lib/import-export'
import { createTestEnv, DEFAULT_NOW, type TestEnv } from '../helpers/env'
import { createFakeHost, type FakeHost, type FakeHostOptions } from '../helpers/fake-host'
import { pairedLocal, registerInstallation, requestsOf, TOKEN_A, unpairedLocal } from '../helpers/shared-setup'

const T1 = '2026-10-01T10:00:00.000Z'
const T2 = '2026-10-02T10:00:00.000Z'

function identity(id: string, updatedAt = T1): Identity {
  return { id, label: id, color: '#336699', order: 0, createdAt: T1, updatedAt }
}

function account(id: string, identityId: string, updatedAt = T1): Account {
  return {
    id,
    identityId,
    groupId: null,
    serviceId: 'github',
    label: id,
    icon: { type: 'auto' },
    favorite: false,
    order: 0,
    createdAt: T1,
    updatedAt,
  }
}

interface Parts {
  readonly mode?: 'single' | 'multi'
  readonly language?: 'auto' | 'es' | 'en'
  readonly revision?: number
  readonly identities?: readonly Identity[]
  readonly accounts?: readonly Account[]
}

function dataOf(parts: Parts = {}): LauncherData {
  const base = createEmptyData()
  return {
    ...base,
    revision: parts.revision ?? 1,
    identities: [...(parts.identities ?? [])],
    accounts: [...(parts.accounts ?? [])],
    settings: { ...base.settings, mode: parts.mode ?? 'single', language: parts.language ?? 'auto' },
  }
}

function numbered(prefix: string, count: number): Identity[] {
  return Array.from({ length: count }, (_, index) => identity(`${prefix}${String(index)}`))
}

function importMessage(data: LauncherData, mode: 'merge' | 'replace', hints?: readonly BindingHint[]) {
  return { type: 'data.import', revision: 0, mode, data, ...(hints === undefined ? {} : { bindingHints: hints }) }
}

const fakes: FakeHost[] = []

afterEach(() => {
  // Ninguna petición al host puede salirse del contrato.
  for (const fake of fakes) expect(fake.invalidRequests).toBe(0)
  fakes.length = 0
})

function newHost(options?: FakeHostOptions): FakeHost {
  const fake = createFakeHost(options)
  fakes.push(fake)
  return fake
}

const WORK: ProfileInfo = { directory: 'Profile 3', name: 'Trabajo', isUsingDefaultName: false }
const DEFAULT_NAMED: ProfileInfo = { directory: 'Profile 4', name: 'Persona 1', isUsingDefaultName: true }

// Instalación local en "Varios perfiles" con un host falso que lista WORK y DEFAULT_NAMED.
function multi(parts: Parts, bindings: Bindings = {}): { t: TestEnv; fake: FakeHost } {
  const fake = newHost({ profiles: [WORK, DEFAULT_NAMED] })
  const t = createTestEnv({
    host: fake,
    local: { ...unpairedLocal('inst-a', dataOf({ ...parts, mode: 'multi' })), localBindings: bindings },
  })
  return { t, fake }
}

describe('data.import local', () => {
  it('merge: recuentos exactos, la revision del mensaje se ignora y se guarda la copia del estado anterior', async () => {
    const current = dataOf({
      revision: 4,
      identities: [identity('i1')],
      accounts: [account('a1', 'i1'), account('a2', 'i1', T2)],
    })
    const t = createTestEnv({ local: unpairedLocal('inst-a', current) })
    const incoming = dataOf({
      revision: 90,
      identities: [identity('i1')],
      accounts: [account('a1', 'i1', T2), account('a2', 'i1', T1), account('a3', 'i1')],
    })

    const response = await t.route({ ...importMessage(incoming, 'merge'), revision: 999 })

    expect(response).toEqual({
      ok: true,
      result: { revision: 5, added: 1, updated: 1, unchanged: 2, removed: 0, unresolved: [] },
    })
    expect(t.local.dump().backup).toEqual({ createdAt: DEFAULT_NOW, source: 'local', data: current, bindings: {} })
    expect(t.local.dump().localData).toEqual({
      ...current,
      revision: 5,
      accounts: [account('a1', 'i1', T2), account('a2', 'i1', T2), account('a3', 'i1')],
    })
    expect(t.local.dump().localBindings).toEqual({})
  })

  it('replace: quita lo que no está en el archivo y conserva el modo de la instalación, el resto de ajustes es del archivo', async () => {
    const current = dataOf({
      revision: 7,
      identities: [identity('i1'), identity('i2')],
      accounts: [account('a1', 'i1'), account('a2', 'i2')],
    })
    const t = createTestEnv({ local: unpairedLocal('inst-a', current) })
    const file = dataOf({
      mode: 'multi',
      language: 'en',
      revision: 50,
      identities: [identity('i1')],
      accounts: [account('a1', 'i1', T2), account('a3', 'i1')],
    })

    const response = await t.route(importMessage(file, 'replace'))

    expect(response).toEqual({
      ok: true,
      result: { revision: 8, added: 1, updated: 1, unchanged: 1, removed: 2, unresolved: [] },
    })
    expect(t.local.dump().localData).toEqual({ ...file, revision: 8, settings: { ...file.settings, mode: 'single' } })
    expect(t.local.dump().backup).toMatchObject({ source: 'local', data: current })
  })

  it('merge que supera LIMITS.identities es import_invalid y no cambia nada ni guarda copia', async () => {
    const current = dataOf({ identities: numbered('c', 60) })
    const t = createTestEnv({ local: unpairedLocal('inst-a', current) })
    const before = t.local.dump()

    const response = await t.route(importMessage(dataOf({ identities: numbered('n', 50) }), 'merge'))

    expect(response).toEqual({ ok: false, error: { code: 'invalid', hint: 'import_invalid' } })
    expect(t.local.dump()).toEqual(before)
    expect(Object.keys(t.local.dump())).not.toContain('backup')
  })

  it('merge que llega justo a LIMITS.identities es válido', async () => {
    const t = createTestEnv({ local: unpairedLocal('inst-a', dataOf({ identities: numbered('c', 60) })) })
    const response = await t.route(
      importMessage(dataOf({ identities: numbered('n', LIMITS.identities - 60) }), 'merge'),
    )
    expect(response).toMatchObject({ ok: true, result: { added: LIMITS.identities - 60, unchanged: 0, removed: 0 } })
  })

  it('un fallo al confirmar es storage_write y los datos siguen igual', async () => {
    const current = dataOf({ identities: [identity('i1')] })
    const t = createTestEnv({ local: unpairedLocal('inst-a', current) })
    // Tras guardar la copia, el siguiente set (la confirmación de los datos) falla.
    t.local.onChange((keys) => {
      if (keys.includes('backup')) t.local.failNextSet()
    })

    const response = await t.route(importMessage(dataOf({ identities: [identity('i2')] }), 'merge'))

    expect(response).toEqual({ ok: false, error: { code: 'internal', hint: 'storage_write' } })
    expect(t.local.dump().localData).toEqual(current)
  })

  it('si no se puede guardar la copia, no se confirma nada: storage_write y los datos siguen igual', async () => {
    const current = dataOf({ identities: [identity('i1')] })
    const t = createTestEnv({ local: unpairedLocal('inst-a', current) })
    const before = t.local.dump()
    t.local.failNextSet()

    const response = await t.route(importMessage(dataOf({ identities: [identity('i2')] }), 'merge'))

    expect(response).toEqual({ ok: false, error: { code: 'internal', hint: 'storage_write' } })
    expect(t.local.dump()).toEqual(before)
  })

  it('datos locales dañados: error de lectura, sin escribir ni guardar copia', async () => {
    const damaged = { ...createEmptyData(), schemaVersion: 2 }
    const t = createTestEnv({ local: { localData: damaged } })

    const response = await t.route(importMessage(dataOf({ identities: [identity('i1')] }), 'replace'))

    expect(response).toEqual({ ok: false, error: { code: 'internal', hint: 'local_data_newer' } })
    expect(t.local.dump().localData).toEqual(damaged)
    expect(Object.keys(t.local.dump())).not.toContain('backup')
  })
})

describe('data.import compartido', () => {
  function shared(sharedData: LauncherData): { t: TestEnv; fake: FakeHost; localBefore: unknown } {
    const fake = newHost()
    registerInstallation(fake, 'inst-a', TOKEN_A)
    fake.state.store = { revision: 1, data: sharedData, bindings: {} }
    // Los datos locales son otros: el almacén compartido es el que manda.
    const local = dataOf({ mode: 'multi', identities: [identity('solo-local')] })
    const t = createTestEnv({ host: fake, local: pairedLocal('inst-a', TOKEN_A, local) })
    return { t, fake, localBefore: t.local.dump().localData }
  }

  it('merge: el host queda con la fusión, la copia es de los datos compartidos y los locales no cambian', async () => {
    const s0 = dataOf({ mode: 'multi', revision: 3, identities: [identity('i1')] })
    const { t, fake, localBefore } = shared(s0)

    const response = await t.route(
      importMessage(dataOf({ identities: [identity('i1'), identity('i2')], accounts: [account('a1', 'i2')] }), 'merge'),
    )

    expect(response).toEqual({
      ok: true,
      result: { revision: 4, added: 2, updated: 0, unchanged: 1, removed: 0, unresolved: [] },
    })
    expect(fake.state.store).toEqual({
      revision: 2,
      data: { ...s0, revision: 4, identities: [identity('i1'), identity('i2')], accounts: [account('a1', 'i2')] },
      bindings: {},
    })
    expect(t.local.dump().backup).toEqual({ createdAt: DEFAULT_NOW, source: 'shared', data: s0, bindings: {} })
    expect(t.local.dump().localData).toEqual(localBefore)
  })

  it('con un conflicto se reaplica sobre lo último del host y los recuentos son los del estado final', async () => {
    const s0 = dataOf({ mode: 'multi', revision: 3, identities: [identity('i1')] })
    const { t, fake } = shared(s0)
    // Otra instalación escribe i2 (igual que la del archivo) justo antes del primer sync.put de la importación.
    const s1 = { ...s0, revision: 4, identities: [identity('i1'), identity('i2')] }
    let raced = false
    fake.override = (request) => {
      if (request.cmd !== 'sync.put' || raced || fake.state.store === undefined) return undefined
      raced = true
      fake.state.store = { revision: 2, data: s1, bindings: {} }
      return { ok: false, error: { code: 'conflict', revision: 2 } }
    }

    const response = await t.route(
      importMessage(dataOf({ identities: [identity('i1'), identity('i2')], accounts: [account('a1', 'i2')] }), 'merge'),
    )

    expect(response).toEqual({
      ok: true,
      result: { revision: 5, added: 1, updated: 0, unchanged: 2, removed: 0, unresolved: [] },
    })
    expect(requestsOf(fake, 'sync.put')).toBe(2)
    expect(fake.state.store).toEqual({
      revision: 3,
      data: { ...s1, revision: 5, accounts: [account('a1', 'i2')] },
      bindings: {},
    })
    // La copia es la del estado sobre el que se confirmó, no la del primer intento.
    expect(t.local.dump().backup).toEqual({ createdAt: DEFAULT_NOW, source: 'shared', data: s1, bindings: {} })
  })

  it('replace desde el almacén compartido conserva su modo y las pistas se resuelven con los perfiles del host', async () => {
    const s0 = dataOf({ mode: 'multi', revision: 3, identities: [identity('i1')] })
    const { t, fake } = shared(s0)
    fake.state.profiles = [WORK]

    const response = await t.route(
      importMessage(dataOf({ mode: 'single', identities: [identity('i2')] }), 'replace', [
        { identityId: 'i2', kind: 'chromium-profile', name: 'Trabajo' },
      ]),
    )

    expect(response).toMatchObject({ ok: true, result: { added: 1, removed: 1, unresolved: [] } })
    expect(fake.state.store).toMatchObject({
      data: { settings: { mode: 'multi' }, identities: [identity('i2')] },
      bindings: { i2: { kind: 'chromium-profile', profileDirectory: 'Profile 3' } },
    })
  })
})

describe('data.import: vínculos', () => {
  const both = [identity('i1'), identity('i2')]
  const trabajo: BindingHint = { identityId: 'i1', kind: 'chromium-profile', name: 'Trabajo' }
  const porDefecto: BindingHint = { identityId: 'i2', kind: 'chromium-profile', name: 'Persona 1' }

  it('en Varios perfiles revincula por nombre y deja sin resolver el perfil con nombre por defecto', async () => {
    const { t, fake } = multi({ identities: both })

    const response = await t.route(importMessage(dataOf({ identities: both }), 'merge', [trabajo, porDefecto]))

    expect(response).toMatchObject({ ok: true, result: { unresolved: ['i2'] } })
    expect(t.local.dump().localBindings).toEqual({ i1: { kind: 'chromium-profile', profileDirectory: 'Profile 3' } })
    expect(requestsOf(fake, 'listProfiles')).toBe(1)
  })

  it('merge conserva el vínculo existente aunque la pista diga otra cosa, y replace lo sustituye', async () => {
    const own: Bindings = { i1: { kind: 'chromium-profile', profileDirectory: 'Default' } }
    const merged = multi({ identities: both }, own)
    expect(
      await merged.t.route(importMessage(dataOf({ identities: both }), 'merge', [trabajo, porDefecto])),
    ).toMatchObject({
      ok: true,
      result: { unresolved: ['i2'] },
    })
    expect(merged.t.local.dump().localBindings).toEqual(own)

    const replaced = multi({ identities: both }, own)
    expect(await replaced.t.route(importMessage(dataOf({ identities: both }), 'replace', [trabajo]))).toMatchObject({
      ok: true,
      result: { unresolved: [] },
    })
    expect(replaced.t.local.dump().localBindings).toEqual({
      i1: { kind: 'chromium-profile', profileDirectory: 'Profile 3' },
    })
  })

  it('merge: una pista sin resolver de una identidad con vínculo propio no aparece en unresolved', async () => {
    const own: Bindings = { i1: { kind: 'current' } }
    const { t } = multi({ identities: both }, own)
    const unknownName: BindingHint = { identityId: 'i1', kind: 'chromium-profile', name: 'Nadie' }

    const response = await t.route(importMessage(dataOf({ identities: both }), 'merge', [unknownName]))

    expect(response).toMatchObject({ ok: true, result: { unresolved: [] } })
    expect(t.local.dump().localBindings).toEqual(own)
  })

  it('replace quita los vínculos de las identidades que ya no están y conserva los demás', async () => {
    const { t } = multi(
      { identities: both },
      { i1: { kind: 'current' }, i2: { kind: 'chromium-profile', profileDirectory: 'Default' } },
    )

    await t.route(importMessage(dataOf({ identities: [identity('i1')] }), 'replace'))

    expect(t.local.dump().localBindings).toEqual({ i1: { kind: 'current' } })
  })

  it('merge también descarta un vínculo huérfano de una identidad que no existe', async () => {
    const { t } = multi({ identities: [identity('i1')] }, { i1: { kind: 'current' }, fantasma: { kind: 'current' } })

    await t.route(importMessage(dataOf({ identities: [identity('i1')] }), 'merge'))

    expect(t.local.dump().localBindings).toEqual({ i1: { kind: 'current' } })
  })

  it('una pista de una identidad que no está en los datos finales se ignora', async () => {
    const { t } = multi({ identities: [identity('i1')] })
    const hints: BindingHint[] = [
      { identityId: 'fantasma', kind: 'chromium-profile', name: 'Nadie' },
      { identityId: 'otra', kind: 'current' },
    ]

    for (const mode of ['merge', 'replace'] as const) {
      const response = await t.route(importMessage(dataOf({ identities: [identity('i1')] }), mode, hints))
      expect(response).toMatchObject({ ok: true, result: { unresolved: [] } })
      expect(t.local.dump().localBindings).toEqual({})
    }
  })

  it('en Perfil único no se llama al host: las pistas de perfil quedan sin resolver y las current se aplican', async () => {
    const fake = newHost({ profiles: [WORK] })
    const t = createTestEnv({ host: fake, local: unpairedLocal('inst-a', dataOf({ mode: 'single' })) })

    const response = await t.route(
      importMessage(dataOf({ identities: both }), 'replace', [trabajo, { identityId: 'i2', kind: 'current' }]),
    )

    expect(response).toMatchObject({ ok: true, result: { unresolved: ['i1'] } })
    expect(t.local.dump().localBindings).toEqual({ i2: { kind: 'current' } })
    expect(fake.requests).toEqual([])
  })

  it('si el host falla al listar los perfiles, la importación sigue y las pistas quedan sin resolver', async () => {
    const { t, fake } = multi({})
    fake.override = (request) =>
      request.cmd === 'listProfiles' ? { ok: false, error: { code: 'internal' } } : undefined

    const response = await t.route(importMessage(dataOf({ identities: both }), 'merge', [trabajo]))

    expect(response).toMatchObject({ ok: true, result: { added: 2, unresolved: ['i1'] } })
    expect(t.local.dump().localBindings).toEqual({})
  })

  it('en Varios perfiles sin host (navegador no reconocido) las pistas de perfil quedan sin resolver', async () => {
    const t = createTestEnv({ local: unpairedLocal('inst-a', dataOf({ mode: 'multi' })) })

    const response = await t.route(importMessage(dataOf({ identities: both }), 'merge', [trabajo]))

    expect(response).toMatchObject({ ok: true, result: { unresolved: ['i1'] } })
  })
})

describe('data.import: ida y vuelta', () => {
  it('exportar en A e importar en una instalación nueva D deja los mismos datos y vínculos', async () => {
    const profiles: ProfileInfo[] = [{ directory: 'Default', name: 'Personal', isUsingDefaultName: false }, WORK]
    const dataA = dataOf({
      mode: 'multi',
      revision: 9,
      language: 'es',
      identities: [identity('i1'), identity('i2')],
      accounts: [account('a1', 'i1'), account('a2', 'i1'), account('a3', 'i2')],
    })
    const bindingsA: Bindings = {
      i1: { kind: 'chromium-profile', profileDirectory: 'Default' },
      i2: { kind: 'chromium-profile', profileDirectory: 'Profile 3' },
    }
    const fake = newHost({ profiles })
    const a = createTestEnv({
      host: fake,
      local: { ...unpairedLocal('inst-a', dataA), localBindings: bindingsA },
    })
    expect(await a.route({ type: 'data.get' })).toMatchObject({ ok: true, result: { data: dataA } })

    const { text } = buildExport(dataA, bindingsA, profiles, new Date('2026-10-08T12:00:00.000Z'))
    const file = readImportText(text)
    if (!file.ok) throw new Error('el archivo exportado no se puede leer')

    // D: instalación nueva, mismo host, en "Varios perfiles".
    const d = createTestEnv({ host: fake, local: {} })
    expect(
      await d.route({ type: 'data.mutate', revision: 0, ops: [{ type: 'settings.set', settings: { mode: 'multi' } }] }),
    ).toEqual({ ok: true, result: { revision: 1 } })

    const response = await d.route(importMessage(file.value.data, 'replace', file.value.bindingHints))

    expect(response).toEqual({
      ok: true,
      result: { revision: 2, added: 5, updated: 0, unchanged: 0, removed: 0, unresolved: [] },
    })
    expect({ ...(d.local.dump().localData as object), revision: 0 }).toEqual({ ...dataA, revision: 0 })
    expect(d.local.dump().localBindings).toEqual(bindingsA)
  })
})
