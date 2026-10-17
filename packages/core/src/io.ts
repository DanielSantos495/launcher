import * as v from 'valibot'
import { isRecord } from './guards'
import { MIGRATIONS, migrate, type Migration } from './migrations'
import { err, ok, type Result } from './result'
import {
  boundedArray,
  IdSchema,
  LauncherDataSchema,
  LIMITS,
  MAX_ISSUES,
  parseLauncherData,
  SCHEMA_VERSION,
  TimestampSchema,
  formatIssues,
  validateData,
  type Binding,
  type Bindings,
  type LauncherData,
  type ProfileInfo,
} from './schema'
import { wellFormed } from './text'

export const APP_ID = 'account-launcher'
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

export const BindingHintSchema = v.strictObject({
  identityId: IdSchema,
  kind: v.picklist(['chromium-profile', 'current']),
  name: v.optional(v.pipe(v.string(), v.maxLength(256), wellFormed)),
})

// Como mucho una pista por identidad, contadas antes de validar cada una (guarda de tamaño, T5). Lo usan el archivo
// exportado y el mensaje data.import de protocol.
export const BindingHintsSchema = boundedArray(BindingHintSchema, LIMITS.identities)

export const ExportFileSchema = v.strictObject({
  app: v.literal(APP_ID),
  schemaVersion: v.literal(SCHEMA_VERSION),
  exportedAt: TimestampSchema,
  data: LauncherDataSchema,
  bindingHints: BindingHintsSchema,
})

export type BindingHint = v.InferOutput<typeof BindingHintSchema>
export type ExportFile = v.InferOutput<typeof ExportFileSchema>

// Los vínculos son propios de cada navegador: se exportan como pistas por nombre visible (§5.2).
// Un nombre por defecto de Brave ("Persona 1") no identifica a nadie: en el otro navegador puede ser el perfil de otra
// persona (T11). Por eso la pista lleva el nombre del perfil solo si el usuario lo eligió (isUsingDefaultName: false);
// si no, o si el perfil ya no existe, lleva el nombre que el usuario pidió al crearlo (desiredName), y si tampoco hay,
// ningún nombre.
export function exportData(
  data: LauncherData,
  bindings: Bindings,
  profiles: readonly ProfileInfo[],
  now: Date = new Date(),
): ExportFile {
  const bindingHints: BindingHint[] = []
  // Solo se exportan pistas de identidades que existen en los datos: parseImport rechaza el resto.
  const known = new Set(data.identities.map((i) => i.id))
  for (const [identityId, binding] of Object.entries(bindings)) {
    if (!known.has(identityId)) continue
    if (binding.kind === 'current') {
      bindingHints.push({ identityId, kind: 'current' })
      continue
    }
    const profile = profiles.find((p) => p.directory === binding.profileDirectory)
    const name = profile !== undefined && !profile.isUsingDefaultName ? profile.name : binding.desiredName
    bindingHints.push(
      name === undefined ? { identityId, kind: binding.kind } : { identityId, kind: binding.kind, name },
    )
  }
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), data, bindingHints }
}

export function serializeExport(file: ExportFile): string {
  return JSON.stringify(file, null, 2)
}

export type ImportErrorCode = 'too_large' | 'invalid_json' | 'not_launcher_file' | 'unsupported_version' | 'invalid'

export interface ImportError {
  readonly code: ImportErrorCode
  readonly issues?: string[]
}

// Las pistas deben apuntar a identidades del propio archivo y no repetirse. Los mensajes llevan solo el índice.
function hintIssues(file: ExportFile): string[] {
  const known = new Set(file.data.identities.map((i) => i.id))
  const seen = new Set<string>()
  const issues: string[] = []
  file.bindingHints.forEach((hint, index) => {
    if (!known.has(hint.identityId)) issues.push(`bindingHints.${String(index)}: identidad desconocida`)
    else if (seen.has(hint.identityId)) issues.push(`bindingHints.${String(index)}: identidad repetida`)
    seen.add(hint.identityId)
  })
  return issues
}

// parseImport valida un archivo importado (§5.4, T5). El tamaño se mide en bytes antes de parsear.
// Las migraciones se aplican a `data` (la misma función migrará después los datos guardados), no al sobre:
// la versión del sobre debe coincidir con la de `data` y pasa a ser la migrada antes de validar el esquema.
export function parseImport(
  text: string,
  table: Readonly<Record<number, Migration>> = MIGRATIONS,
  current: number = SCHEMA_VERSION,
): Result<ExportFile, ImportError> {
  // Cada unidad UTF-16 ocupa al menos 1 byte: si ya hay más unidades que el límite, no hace falta codificar.
  if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return err({ code: 'too_large' })
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return err({ code: 'invalid_json' })
  }
  if (!isRecord(raw) || raw.app !== APP_ID) return err({ code: 'not_launcher_file' })
  const version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return err({ code: 'invalid' })
  if (version > current) return err({ code: 'unsupported_version' })
  if (!isRecord(raw.data) || raw.data.schemaVersion !== version) return err({ code: 'invalid' })
  const migrated = migrate(raw.data, current, table)
  if (!migrated.ok) return err({ code: migrated.error })
  const envelope = { ...raw, schemaVersion: migrated.value.schemaVersion, data: migrated.value }
  const parsed = v.safeParse(ExportFileSchema, envelope)
  if (!parsed.success) return err({ code: 'invalid', issues: formatIssues(parsed.issues) })
  const valid = validateData(parsed.output.data)
  const issues = [...(valid.ok ? [] : valid.error), ...hintIssues(parsed.output)]
  if (issues.length > 0) return err({ code: 'invalid', issues: issues.slice(0, MAX_ISSUES) })
  return ok(parsed.output)
}

// loadData carga unos datos guardados fuera de la extensión: migra y después valida con el esquema completo y las
// reglas cruzadas. El SW la usa con el `data` de sync.get (el host solo comprueba su estructura, ADR-004) y la usará
// con lo que guarda en storage.local. Una versión más nueva que la de esta extensión es unsupported_version.
export function loadData(
  raw: unknown,
  table: Readonly<Record<number, Migration>> = MIGRATIONS,
  current: number = SCHEMA_VERSION,
): Result<LauncherData, ImportError> {
  const migrated = migrate(raw, current, table)
  if (!migrated.ok) return err({ code: migrated.error })
  const parsed = parseLauncherData(migrated.value)
  return parsed.ok ? parsed : err({ code: 'invalid', issues: parsed.error })
}

export interface ImportPlan {
  readonly data: LauncherData
  readonly added: number
  readonly updated: number
  readonly unchanged: number
  readonly removed: number
}

interface Entity {
  readonly id: string
  readonly updatedAt: string
}

interface Tally {
  added: number
  updated: number
  unchanged: number
  removed: number
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Combina una colección. Es genérica para que cada una conserve su tipo y no haga falta ninguna conversión.
// "replace" sustituye todo; "merge" añade lo nuevo y, si un id existe, gana el updatedAt más reciente.
function planCollection<T extends Entity>(
  current: readonly T[],
  incoming: readonly T[],
  mode: 'merge' | 'replace',
): { items: T[]; tally: Tally } {
  const tally: Tally = { added: 0, updated: 0, unchanged: 0, removed: 0 }
  const before = new Map<string, T>(current.map((e) => [e.id, e]))
  const after = new Map<string, T>(mode === 'merge' ? before : [])
  for (const item of incoming) {
    const old = before.get(item.id)
    if (old === undefined) {
      tally.added++
      after.set(item.id, item)
    } else if (same(old, item)) {
      tally.unchanged++
      after.set(item.id, old)
    } else if (mode === 'replace' || item.updatedAt > old.updatedAt) {
      tally.updated++
      after.set(item.id, item)
    } else {
      tally.unchanged++
    }
  }
  if (mode === 'replace') tally.removed = [...before.keys()].filter((id) => !after.has(id)).length
  return { items: [...after.values()], tally }
}

// planImport calcula el resultado y el resumen que se muestra antes de confirmar (§5.4).
export function planImport(
  current: LauncherData,
  incoming: LauncherData,
  mode: 'merge' | 'replace',
): Result<ImportPlan, ImportError> {
  const identities = planCollection(current.identities, incoming.identities, mode)
  const groups = planCollection(current.groups, incoming.groups, mode)
  const accounts = planCollection(current.accounts, incoming.accounts, mode)
  const customServices = planCollection(current.customServices, incoming.customServices, mode)
  const tallies = [identities.tally, groups.tally, accounts.tally, customServices.tally]
  const data: LauncherData = {
    ...current,
    identities: identities.items,
    groups: groups.items,
    accounts: accounts.items,
    customServices: customServices.items,
    settings: mode === 'replace' ? incoming.settings : current.settings,
    revision: current.revision + 1,
  }
  // Esquema completo (límites incluidos) y reglas cruzadas:
  // fusionar puede superar LIMITS aunque cada parte sea válida.
  const valid = parseLauncherData(data)
  if (!valid.ok) return err({ code: 'invalid', issues: valid.error })
  return ok({
    data: valid.value,
    added: tallies.reduce((n, t) => n + t.added, 0),
    updated: tallies.reduce((n, t) => n + t.updated, 0),
    unchanged: tallies.reduce((n, t) => n + t.unchanged, 0),
    removed: tallies.reduce((n, t) => n + t.removed, 0),
  })
}

// rebindFromHints empareja cada pista con un perfil existente por nombre exacto. Nunca crea perfiles (T5).
// Si no hay exactamente un perfil con ese nombre, la identidad queda sin resolver y conserva su vínculo anterior.
// Los perfiles con el nombre por defecto de Brave no son candidatos: "Persona 1" no dice de quién es el perfil (T11).
export function rebindFromHints(
  hints: readonly BindingHint[],
  profiles: readonly ProfileInfo[],
  existing: Bindings = {},
): { bindings: Record<string, Binding>; unresolved: string[] } {
  const bindings: Record<string, Binding> = { ...existing }
  const unresolved: string[] = []
  const named = profiles.filter((p) => !p.isUsingDefaultName)
  for (const hint of hints) {
    if (hint.kind === 'current') {
      bindings[hint.identityId] = { kind: 'current' }
      continue
    }
    const matches = named.filter((p) => p.name === hint.name)
    const match = matches.length === 1 ? matches[0] : undefined
    if (match === undefined) {
      unresolved.push(hint.identityId)
      continue
    }
    bindings[hint.identityId] = { kind: 'chromium-profile', profileDirectory: match.directory }
  }
  return { bindings, unresolved }
}
