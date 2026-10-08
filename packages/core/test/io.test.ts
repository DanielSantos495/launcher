import { describe, expect, it } from 'vitest'
import {
  exportData,
  MAX_IMPORT_BYTES,
  parseImport,
  planImport,
  rebindFromHints,
  serializeExport,
  type ImportPlan,
} from '../src/io'
import { createEmptyData, LIMITS, type Bindings, type ProfileInfo } from '../src/schema'
import { account, data, group, identity, T0, T1 } from './fixtures'

const profiles: ProfileInfo[] = [
  { directory: 'Launcher-work0001', name: 'Trabajo', isUsingDefaultName: false },
  { directory: 'Profile 1', name: 'Casa', isUsingDefaultName: false },
]
const bindings: Bindings = {
  'id-work': { kind: 'chromium-profile', profileDirectory: 'Launcher-work0001' },
  'id-home': { kind: 'current' },
}
const people = [identity(), identity({ id: 'id-home', label: 'Casa', email: 'casa@example.com' })]
const full = data({ identities: people, groups: [group()], accounts: [account({ groupId: 'grp-dev' })] })
const now = new Date(T1)

describe('exportData', () => {
  it('reduce los vínculos a pistas por nombre visible', () => {
    const file = exportData(full, bindings, profiles, now)
    expect(file.exportedAt).toBe(T1)
    expect(file.bindingHints).toEqual([
      { identityId: 'id-work', kind: 'chromium-profile', name: 'Trabajo' },
      { identityId: 'id-home', kind: 'current' },
    ])
  })

  it('omite el nombre si el perfil ya no existe y usa la fecha actual por defecto', () => {
    const file = exportData(full, { 'id-work': { kind: 'chromium-profile', profileDirectory: 'Borrado' } }, profiles)
    expect(file.bindingHints).toEqual([{ identityId: 'id-work', kind: 'chromium-profile' }])
    expect(file.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

describe('exportData (identidades que ya no existen)', () => {
  it('no exporta pistas de vínculos huérfanos, para que el archivo se pueda importar', () => {
    const stale: Bindings = { ...bindings, 'id-borrada': { kind: 'current' } }
    const file = exportData(full, stale, profiles, now)
    expect(file.bindingHints.map((h) => h.identityId)).toEqual(['id-work', 'id-home'])
    expect(parseImport(serializeExport(file)).ok).toBe(true)
  })
})

describe('parseImport', () => {
  const text = serializeExport(exportData(full, bindings, profiles, now))

  it('acepta un archivo exportado', () => {
    const r = parseImport(text)
    expect(r.ok && r.value.data).toEqual(full)
  })

  it.each([
    ['x'.repeat(MAX_IMPORT_BYTES + 1), 'too_large'],
    ['{no es json', 'invalid_json'],
    ['[]', 'not_launcher_file'],
    ['{"app":"otra"}', 'not_launcher_file'],
  ])('rechaza %#', (input, code) => {
    const r = parseImport(input)
    expect(r.ok ? undefined : r.error.code).toBe(code)
  })

  it('rechaza un archivo de una versión futura (Review Focus 1)', () => {
    const future = JSON.stringify({ ...JSON.parse(text), schemaVersion: 2 })
    const r = parseImport(future)
    expect(r.ok ? undefined : r.error.code).toBe('unsupported_version')
  })

  it('rechaza javascript: y campos desconocidos con mensajes', () => {
    const bad = JSON.parse(text) as { data: { accounts: { url?: string }[] } }
    const first = bad.data.accounts[0]
    if (first) first.url = 'javascript:alert(1)'
    const r = parseImport(JSON.stringify(bad))
    expect(r.ok ? undefined : r.error.code).toBe('invalid')
    const extra = JSON.stringify({ ...JSON.parse(text), extra: true })
    expect(parseImport(extra).ok).toBe(false)
  })

  it('rechaza un archivo de la app sin versión', () => {
    const r = parseImport('{"app":"account-launcher"}')
    expect(r.ok ? undefined : r.error.code).toBe('invalid')
  })

  it('informa de los fallos de esquema sin copiar valores', () => {
    const bad = JSON.parse(text) as { data: { identities: { email?: string }[] } }
    const first = bad.data.identities[0]
    if (first) first.email = 'no-es-un-email@@example.com'
    const r = parseImport(JSON.stringify(bad))
    expect(r.ok ? undefined : r.error.code).toBe('invalid')
    expect(r.ok ? [] : r.error.issues).toEqual(['data.identities.0.email: email'])
  })

  it('valida las referencias cruzadas sin copiar URLs ni emails', () => {
    const orphan = data({
      identities: people,
      accounts: [account({ identityId: 'id-nadie', url: 'https://secreto.example.com/ruta' })],
    })
    const r = parseImport(serializeExport(exportData(orphan, bindings, profiles, now)))
    expect(r.ok ? undefined : r.error.code).toBe('invalid')
    expect(r.ok ? [] : r.error.issues).toEqual(['accounts.acc-github: identidad desconocida'])
  })

  type Envelope = { schemaVersion?: unknown; data: { schemaVersion?: unknown }; bindingHints: unknown[] }
  const withEnvelope = (edit: (file: Envelope) => void): string => {
    const file = JSON.parse(text) as Envelope
    edit(file)
    return JSON.stringify(file)
  }

  it('rechaza pistas que apuntan a una identidad que no está en los datos', () => {
    const r = parseImport(withEnvelope((f) => f.bindingHints.push({ identityId: 'id-nadie', kind: 'current' })))
    expect(r.ok ? undefined : r.error).toEqual({ code: 'invalid', issues: ['bindingHints.2: identidad desconocida'] })
  })

  it('rechaza dos pistas para la misma identidad', () => {
    const r = parseImport(withEnvelope((f) => f.bindingHints.push({ identityId: 'id-home', kind: 'current' })))
    expect(r.ok ? undefined : r.error).toEqual({ code: 'invalid', issues: ['bindingHints.2: identidad repetida'] })
  })

  it.each([
    ['sin versión en el sobre', (f: Envelope) => delete f.schemaVersion],
    ['versión 0', (f: Envelope) => (f.schemaVersion = 0)],
    ['versión no entera', (f: Envelope) => (f.schemaVersion = 1.5)],
    ['versión como texto', (f: Envelope) => (f.schemaVersion = '1')],
    ['sobre y datos con versiones distintas', (f: Envelope) => (f.data.schemaVersion = 0)],
    ['data sin versión', (f: Envelope) => delete f.data.schemaVersion],
    ['data que no es un objeto', (f: Envelope) => ((f as { data: unknown }).data = [])],
  ])('rechaza %s', (_name, edit) => {
    const r = parseImport(withEnvelope(edit))
    expect(r.ok ? undefined : r.error.code).toBe('invalid')
  })

  it('rechaza una versión futura también cuando los datos la declaran', () => {
    const r = parseImport(
      withEnvelope((f) => {
        f.schemaVersion = 2
        f.data.schemaVersion = 2
      }),
    )
    expect(r.ok ? undefined : r.error.code).toBe('unsupported_version')
  })

  it('aplica las migraciones a data, no al sobre, y fija la versión migrada en el sobre', () => {
    // ExportFileSchema sigue fijado a la versión 1: con current = 2 el esquema debe fallar después de migrar.
    // La migración registra lo que recibe para comprobar que ha recibido los datos y no el sobre, y los dos
    // fallos de esquema (sobre y data) demuestran que ambos llevan ya la versión migrada.
    const received: Record<string, unknown>[] = []
    const table = {
      1: (x: Record<string, unknown>) => {
        received.push(x)
        return { ...x, revision: 99 }
      },
    }
    const r = parseImport(text, table, 2)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ schemaVersion: 1, revision: 0, identities: people })
    expect(received[0]).not.toHaveProperty('app')
    expect(received[0]).not.toHaveProperty('bindingHints')
    expect(r.ok ? undefined : r.error).toEqual({
      code: 'invalid',
      issues: ['schemaVersion: literal', 'data.schemaVersion: literal'],
    })
  })

  it('falla si la tabla no tiene el paso de migración necesario', () => {
    const r = parseImport(text, {}, 2)
    expect(r.ok ? undefined : r.error).toEqual({ code: 'invalid' })
  })

  it('el límite de tamaño es exacto: MAX bytes se procesa y MAX + 1 se rechaza', () => {
    const code = (input: string) => {
      const r = parseImport(input)
      return r.ok ? undefined : r.error.code
    }
    expect(code(' '.repeat(MAX_IMPORT_BYTES))).toBe('invalid_json')
    expect(code(' '.repeat(MAX_IMPORT_BYTES + 1))).toBe('too_large')
    // Con caracteres de 2 bytes hay menos unidades que el límite, así que decide la codificación.
    expect(code('ñ'.repeat(MAX_IMPORT_BYTES / 2))).toBe('invalid_json')
    expect(code('ñ'.repeat(MAX_IMPORT_BYTES / 2 - 1) + 'abc')).toBe('too_large')
  })

  it('cuenta el tamaño en bytes, no en caracteres', () => {
    const r = parseImport('ñ'.repeat(MAX_IMPORT_BYTES / 2 + 1))
    expect(r.ok ? undefined : r.error.code).toBe('too_large')
  })
})

describe('planImport', () => {
  it('reemplazar cuenta altas, cambios y bajas', () => {
    const incoming = data({ identities: people, accounts: [account({ label: 'GitHub nuevo', updatedAt: T1 })] })
    const r = planImport(full, incoming, 'replace')
    expect(r.ok && { ...r.value, data: undefined }).toEqual({
      data: undefined,
      added: 0,
      updated: 1,
      unchanged: 2,
      removed: 1,
    })
    expect(r.ok && r.value.data.revision).toBe(full.revision + 1)
  })

  it('fusionar: gana el updatedAt más reciente y se conservan los ajustes', () => {
    const newer = account({ label: 'Nuevo', updatedAt: T1 })
    const older = account({ id: 'acc-github', label: 'Viejo', updatedAt: '2026-01-01T00:00:00.000Z' })
    const current = data({ identities: people, accounts: [account({ updatedAt: T0 })] })
    const incomingNew = data({
      identities: people,
      accounts: [newer],
      settings: { ...createEmptyData().settings, mode: 'multi' },
    })
    const merged = planImport(current, incomingNew, 'merge')
    expect(merged.ok && merged.value.data.accounts[0]?.label).toBe('Nuevo')
    expect(merged.ok && merged.value.data.settings.mode).toBe('single')
    const kept = planImport(current, data({ identities: people, accounts: [older] }), 'merge')
    expect(kept.ok && kept.value.data.accounts[0]?.label).toBe('GitHub')
    expect(kept.ok && kept.value.unchanged).toBeGreaterThan(0)
  })
})

describe('planImport (conteos y rutas)', () => {
  const counts = ({ added, updated, unchanged, removed }: ImportPlan) => ({ added, updated, unchanged, removed })
  const base = data({ identities: people, accounts: [account({ label: 'Actual', updatedAt: T1 })] })
  const labels = (r: ReturnType<typeof planImport>) => r.ok && r.value.data.accounts.map((a) => a.label)

  it('reemplazar con un elemento más antiguo lo sustituye (restaurar una copia)', () => {
    const copy = data({ identities: people, accounts: [account({ label: 'Copia', updatedAt: T0 })] })
    const r = planImport(base, copy, 'replace')
    expect(labels(r)).toEqual(['Copia'])
    expect(r.ok && counts(r.value)).toEqual({ added: 0, updated: 1, unchanged: 2, removed: 0 })
  })

  it('reemplazar cuenta las altas y las bajas', () => {
    const extra = data({ identities: people, accounts: [account({ id: 'acc-extra', label: 'Extra' })] })
    const r = planImport(base, extra, 'replace')
    expect(r.ok && r.value.data.accounts.map((a) => a.id)).toEqual(['acc-extra'])
    expect(r.ok && counts(r.value)).toEqual({ added: 1, updated: 0, unchanged: 2, removed: 1 })
  })

  it('fusionar añade lo nuevo, conserva lo que solo está en los datos actuales y no da bajas', () => {
    const incoming = data({ identities: people, accounts: [account({ id: 'acc-extra', label: 'Extra' })] })
    const r = planImport(base, incoming, 'merge')
    expect(r.ok && r.value.data.accounts.map((a) => a.id)).toEqual(['acc-github', 'acc-extra'])
    expect(r.ok && counts(r.value)).toEqual({ added: 1, updated: 0, unchanged: 2, removed: 0 })
  })

  it('fusionar con un updatedAt más reciente actualiza y cuenta el cambio', () => {
    const newer = data({
      identities: people,
      accounts: [account({ label: 'Nuevo', updatedAt: '2026-11-01T00:00:00.000Z' })],
    })
    const r = planImport(base, newer, 'merge')
    expect(labels(r)).toEqual(['Nuevo'])
    expect(r.ok && counts(r.value)).toEqual({ added: 0, updated: 1, unchanged: 2, removed: 0 })
  })

  it('fusionar con el mismo updatedAt y distinto contenido conserva lo actual y lo cuenta como sin cambios', () => {
    const tie = data({ identities: people, accounts: [account({ label: 'Otro', updatedAt: T1 })] })
    const r = planImport(base, tie, 'merge')
    expect(labels(r)).toEqual(['Actual'])
    expect(r.ok && counts(r.value)).toEqual({ added: 0, updated: 0, unchanged: 3, removed: 0 })
  })

  it('rechaza un resultado que supera los límites aunque cada parte los cumpla', () => {
    const batch = (prefix: string) =>
      Array.from({ length: LIMITS.identities - 40 }, (_, n) => identity({ id: `${prefix}-${String(n)}`, order: n }))
    const mine = data({ identities: batch('a') })
    const theirs = data({ identities: batch('b') })
    const merged = planImport(mine, theirs, 'merge')
    expect(merged.ok ? undefined : merged.error).toEqual({ code: 'invalid', issues: ['identities: max_length'] })
    expect(planImport(mine, theirs, 'replace').ok).toBe(true)
  })
})

describe('planImport (resultado no válido)', () => {
  it('fusionar rechaza el resultado si la política de URL de los ajustes actuales no lo admite', () => {
    const http = account({ id: 'acc-http', url: 'http://intranet.example.com/', updatedAt: T1 })
    const incoming = data({
      identities: people,
      accounts: [http],
      settings: { ...createEmptyData().settings, allowHttp: true },
    })
    const current = data({ identities: people })
    expect(planImport(current, incoming, 'replace').ok).toBe(true)
    const r = planImport(current, incoming, 'merge')
    expect(r.ok ? undefined : r.error).toEqual({ code: 'invalid', issues: ['accounts.acc-http: URL no válida'] })
  })
})

describe('rebindFromHints', () => {
  it('revincula por nombre y deja sin resolver lo ambiguo o lo que no existe', () => {
    const hints = [
      { identityId: 'id-work', kind: 'chromium-profile' as const, name: 'Trabajo' },
      { identityId: 'id-home', kind: 'current' as const },
      { identityId: 'id-x', kind: 'chromium-profile' as const, name: 'Repetido' },
      { identityId: 'id-y', kind: 'chromium-profile' as const, name: 'No existe' },
    ]
    const twice = [...profiles, { directory: 'A', name: 'Repetido', isUsingDefaultName: false }]
    const r = rebindFromHints(hints, [...twice, { directory: 'B', name: 'Repetido', isUsingDefaultName: false }], {
      'id-y': { kind: 'current' },
    })
    expect(r.bindings).toEqual({
      'id-work': { kind: 'chromium-profile', profileDirectory: 'Launcher-work0001' },
      'id-home': { kind: 'current' },
      'id-y': { kind: 'current' },
    })
    expect(r.unresolved).toEqual(['id-x', 'id-y'])
  })
})

describe('rebindFromHints (sin nombre)', () => {
  it('deja sin resolver una pista de perfil que no trae nombre y no toca los vínculos existentes', () => {
    const existing: Bindings = { 'id-work': { kind: 'current' } }
    const r = rebindFromHints([{ identityId: 'id-work', kind: 'chromium-profile' }], profiles, existing)
    expect(r).toEqual({ bindings: { 'id-work': { kind: 'current' } }, unresolved: ['id-work'] })
    expect(existing).toEqual({ 'id-work': { kind: 'current' } })
  })
})

describe('ida y vuelta (criterio de F1)', () => {
  it('exportar, borrar e importar deja los mismos datos y los mismos vínculos', () => {
    const text = serializeExport(exportData(full, bindings, profiles, now))
    const parsed = parseImport(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const plan = planImport(createEmptyData(), parsed.value.data, 'replace')
    expect(plan.ok && { ...plan.value.data, revision: full.revision }).toEqual(full)
    expect(rebindFromHints(parsed.value.bindingHints, profiles).bindings).toEqual(bindings)
  })
})
