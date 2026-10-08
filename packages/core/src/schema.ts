import * as v from 'valibot'
import { err, ok, type Result } from './result'
import { isValidTemplate } from './template'
import { hasControlChars } from './text'
import { MAX_URL_LENGTH, normalizeUrl } from './url'

export const SCHEMA_VERSION = 1

export const LIMITS = {
  identities: 100,
  groups: 200,
  accounts: 2000,
  customServices: 100,
  label: 80,
  username: 128,
  notes: 2000,
} as const

export const CATALOG_IDS = [
  'google.gmail',
  'google.gemini',
  'github',
  'claude',
  'chatgpt',
  'shopify',
  'cloudflare',
  'generic',
] as const

// Texto visible: no vacío, sin caracteres de control y con longitud máxima.
const visibleText = (max: number) =>
  v.pipe(
    v.string(),
    v.maxLength(max),
    v.check((s) => s.trim() !== '' && !hasControlChars(s), 'texto vacío o con caracteres de control'),
  )

// Nombres que no son claves de objeto seguras: v.record los omite sin avisar, así que un id no puede coincidir con ellos.
const RESERVED_IDS: readonly string[] = ['__proto__', 'constructor', 'prototype']

export const IdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{1,64}$/, 'id no válido'),
  v.check((s) => !RESERVED_IDS.includes(s), 'id no válido'),
)

// Solo la forma canónica de Date.prototype.toISOString(): otra tarea compara las marcas como cadenas.
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
export const TimestampSchema = v.pipe(
  v.string(),
  v.regex(CANONICAL_TIMESTAMP, 'fecha no válida'),
  v.check((s) => {
    const date = new Date(s)
    return !Number.isNaN(date.getTime()) && date.toISOString() === s
  }, 'fecha no válida'),
)
export const RevisionSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const ColorSchema = v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/, 'color no válido'))
const OrderSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_000_000))
const EmailSchema = v.pipe(v.string(), v.maxLength(254), v.email())

export const IconRefSchema = v.variant('type', [
  v.strictObject({ type: v.literal('auto') }),
  v.strictObject({ type: v.literal('bundled'), name: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,40}$/)) }),
  v.strictObject({
    type: v.literal('emoji'),
    value: v.pipe(
      v.string(),
      v.minLength(1),
      v.maxLength(16),
      v.check((s) => !hasControlChars(s), 'caracteres de control'),
    ),
  }),
  v.strictObject({ type: v.literal('image'), key: v.pipe(v.string(), v.regex(/^icon:[A-Za-z0-9_-]{1,64}$/)) }),
])

export const ServiceIdSchema = v.union([
  v.picklist(CATALOG_IDS),
  v.pipe(v.string(), v.regex(/^custom:[A-Za-z0-9_-]{1,64}$/, 'servicio no válido')),
])

// Carpeta de perfil: un único elemento de ruta, sin "-" inicial (no puede parecer un switch) ni controles (T2).
export function isSafeDirectoryName(s: string): boolean {
  return s !== '.' && s !== '..' && !s.startsWith('-') && !/[/\\]/.test(s) && !hasControlChars(s)
}

export const ProfileDirectorySchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(255),
  v.check(isSafeDirectoryName, 'carpeta de perfil no válida'),
)

export const IdentitySchema = v.strictObject({
  id: IdSchema,
  label: visibleText(LIMITS.label),
  email: v.optional(EmailSchema),
  color: ColorSchema,
  avatar: v.optional(IconRefSchema),
  order: OrderSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export const GroupSchema = v.strictObject({
  id: IdSchema,
  name: visibleText(LIMITS.label),
  color: ColorSchema,
  icon: v.optional(IconRefSchema),
  order: OrderSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export const AccountSchema = v.strictObject({
  id: IdSchema,
  identityId: IdSchema,
  groupId: v.nullable(IdSchema),
  serviceId: ServiceIdSchema,
  label: visibleText(LIMITS.label),
  // La política de URL depende de settings.allowHttp: la comprueba validateData.
  url: v.optional(v.pipe(v.string(), v.maxLength(MAX_URL_LENGTH))),
  username: v.optional(visibleText(LIMITS.username)),
  notes: v.optional(
    v.pipe(
      v.string(),
      v.maxLength(LIMITS.notes),
      v.check((s) => !hasControlChars(s, '\n\t'), 'caracteres de control'),
    ),
  ),
  icon: IconRefSchema,
  favorite: v.boolean(),
  contextOverride: v.optional(v.picklist(['identity', 'current'])),
  order: OrderSchema,
  lastOpenedAt: v.optional(TimestampSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export const CustomServiceSchema = v.strictObject({
  id: IdSchema,
  name: visibleText(LIMITS.label),
  urlTemplate: v.pipe(v.string(), v.maxLength(MAX_URL_LENGTH)),
  multiAccount: v.picklist(['parallel', 'switch', 'none']),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export const SettingsSchema = v.strictObject({
  mode: v.picklist(['single', 'multi']),
  language: v.picklist(['auto', 'es', 'en']),
  defaultView: v.picklist(['identity', 'group']),
  theme: v.picklist(['system', 'light', 'dark']),
  allowHttp: v.boolean(),
})

export const LauncherDataSchema = v.strictObject({
  schemaVersion: v.literal(SCHEMA_VERSION),
  revision: RevisionSchema,
  identities: v.pipe(v.array(IdentitySchema), v.maxLength(LIMITS.identities)),
  groups: v.pipe(v.array(GroupSchema), v.maxLength(LIMITS.groups)),
  accounts: v.pipe(v.array(AccountSchema), v.maxLength(LIMITS.accounts)),
  customServices: v.pipe(v.array(CustomServiceSchema), v.maxLength(LIMITS.customServices)),
  settings: SettingsSchema,
})

export const BindingSchema = v.variant('kind', [
  v.strictObject({
    kind: v.literal('chromium-profile'),
    profileDirectory: ProfileDirectorySchema,
    // Nombre que pidió el usuario al crear el perfil; la UI comprueba que Brave ya lo muestra (§5.2).
    desiredName: v.optional(visibleText(LIMITS.label)),
  }),
  v.strictObject({ kind: v.literal('current') }),
])

export const BindingsSchema = v.pipe(
  v.unknown(),
  // v.record omite estas claves antes de validarlas: se rechazan aquí, sobre la entrada.
  v.check(
    (input) => typeof input !== 'object' || input === null || !RESERVED_IDS.some((key) => Object.hasOwn(input, key)),
    'id no válido',
  ),
  v.record(IdSchema, BindingSchema),
  v.check((r) => Object.keys(r).length <= LIMITS.identities, 'demasiados vínculos'),
)

export const ProfileInfoSchema = v.strictObject({
  directory: ProfileDirectorySchema,
  name: v.pipe(v.string(), v.maxLength(256)),
  isUsingDefaultName: v.boolean(),
  color: v.optional(ColorSchema),
})

export type ID = string
export type IconRef = v.InferOutput<typeof IconRefSchema>
export type Identity = v.InferOutput<typeof IdentitySchema>
export type Group = v.InferOutput<typeof GroupSchema>
export type Account = v.InferOutput<typeof AccountSchema>
export type CustomService = v.InferOutput<typeof CustomServiceSchema>
export type Settings = v.InferOutput<typeof SettingsSchema>
export type LauncherData = v.InferOutput<typeof LauncherDataSchema>
export type Binding = v.InferOutput<typeof BindingSchema>
export type Bindings = Readonly<Record<ID, Binding>>
export type ProfileInfo = v.InferOutput<typeof ProfileInfoSchema>

export function createEmptyData(): LauncherData {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    identities: [],
    groups: [],
    accounts: [],
    customServices: [],
    settings: { mode: 'single', language: 'auto', defaultView: 'identity', theme: 'system', allowHttp: false },
  }
}

// Segmentos de ruta que se muestran tal cual: índices numéricos y nombres de campo con forma de identificador.
// Cualquier otra clave (p. ej. un campo desconocido que sea un email) se sustituye por "?".
const SAFE_PATH_KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/

function pathSegment(key: unknown): string {
  if (typeof key === 'number' && Number.isInteger(key) && key >= 0) return String(key)
  return typeof key === 'string' && SAFE_PATH_KEY.test(key) ? key : '?'
}

// El mensaje se construye solo con la ruta saneada y el tipo de regla de Valibot (ej. "identities.0.email: email").
// Nunca se copia el mensaje de Valibot ni el valor recibido: podrían ser URLs, emails o notas.
export function formatIssues(issues: readonly v.BaseIssue<unknown>[]): string[] {
  return issues.map((issue) => {
    const path = (issue.path ?? []).map((item) => pathSegment(item.key)).join('.')
    return path === '' ? issue.type : `${path}: ${issue.type}`
  })
}

// validateData comprueba lo que un esquema por campo no puede: ids únicos, referencias y política de URL.
// Los mensajes llevan ids, nunca URLs ni emails.
export function validateData(data: LauncherData): Result<LauncherData, string[]> {
  const issues: string[] = []
  const policy = { allowHttp: data.settings.allowHttp }
  const collect = (name: string, list: readonly { id: string }[]): Set<string> => {
    const seen = new Set<string>()
    for (const item of list) {
      if (seen.has(item.id)) issues.push(`${name}.${item.id}: id repetido`)
      seen.add(item.id)
    }
    return seen
  }
  const identities = collect('identities', data.identities)
  const groups = collect('groups', data.groups)
  const services = collect('customServices', data.customServices)
  collect('accounts', data.accounts)
  for (const service of data.customServices) {
    if (!isValidTemplate(service.urlTemplate, policy)) issues.push(`customServices.${service.id}: plantilla no válida`)
  }
  for (const a of data.accounts) {
    if (!identities.has(a.identityId)) issues.push(`accounts.${a.id}: identidad desconocida`)
    if (a.groupId !== null && !groups.has(a.groupId)) issues.push(`accounts.${a.id}: grupo desconocido`)
    if (a.serviceId.startsWith('custom:') && !services.has(a.serviceId.slice('custom:'.length))) {
      issues.push(`accounts.${a.id}: servicio desconocido`)
    }
    if (a.url !== undefined && !normalizeUrl(a.url, policy).ok) issues.push(`accounts.${a.id}: URL no válida`)
    if (a.serviceId === 'generic' && a.url === undefined)
      issues.push(`accounts.${a.id}: el servicio genérico necesita URL`)
  }
  return issues.length === 0 ? ok(data) : err(issues)
}

export function parseLauncherData(input: unknown): Result<LauncherData, string[]> {
  const parsed = v.safeParse(LauncherDataSchema, input)
  if (!parsed.success) return err(formatIssues(parsed.issues))
  return validateData(parsed.output)
}
