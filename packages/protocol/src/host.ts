import {
  BindingsSchema,
  err,
  hasControlChars,
  IdSchema,
  LauncherDataSchema,
  normalizeUrl,
  ok,
  ProfileDirectorySchema,
  ProfileInfoSchema,
  RevisionSchema,
  TimestampSchema,
  type Result,
} from '@account-launcher/core'
import * as v from 'valibot'
import { MAX_CONTAINER_NAME, MAX_ICON_BYTES, PROTOCOL_VERSION } from './limits'

// Token de emparejamiento: 256 bits en base64url sin relleno (43 caracteres).
export const TokenSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/))
export const PairCodeSchema = v.pipe(v.string(), v.regex(/^\d{6}$/))
export const NonceSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{16,64}$/))

// Nombre de contenedor temporal (T2): la longitud se cuenta en puntos de código, como las runas de Go.
export function isValidContainerName(name: string): boolean {
  return (
    Array.from(name).length <= MAX_CONTAINER_NAME &&
    name.trim() !== '' &&
    !name.startsWith('-') &&
    !name.includes('=') &&
    !hasControlChars(name)
  )
}
export const ContainerNameSchema = v.pipe(v.string(), v.check(isValidContainerName, 'nombre no válido'))

// El host solo acepta URLs ya canónicas (las produce core.normalizeUrl): una sola forma por URL (T2).
// http se admite porque el core solo lo deja pasar si el usuario activó allowHttp.
export const HostUrlSchema = v.pipe(
  v.string(),
  v.check((s) => {
    const r = normalizeUrl(s, { allowHttp: true })
    return r.ok && r.value === s
  }, 'URL no válida'),
)

export const IconKeySchema = v.pipe(v.string(), v.regex(/^icon:[A-Za-z0-9_-]{1,64}$/))
export const IconMimeSchema = v.picklist(['image/png', 'image/jpeg', 'image/webp'])
export const Base64Schema = v.pipe(
  v.string(),
  v.minLength(4),
  v.maxLength(Math.ceil(MAX_ICON_BYTES / 3) * 4),
  v.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
)

// Valibot da por buenos los arrays como "objetos": sin esta guarda, `args: []` pasaría en los comandos sin argumentos
// obligatorios y `result: []` en las respuestas vacías. Go los rechaza al decodificar, así que aquí también (T2).
const NotArray = v.check((input: unknown) => !Array.isArray(input), 'se esperaba un objeto')
function exactObject<const E extends v.ObjectEntries>(entries: E) {
  return v.pipe(v.unknown(), NotArray, v.strictObject(entries))
}

function request<const C extends string, const A extends v.ObjectEntries>(cmd: C, args: A) {
  return v.strictObject({ v: v.literal(PROTOCOL_VERSION), cmd: v.literal(cmd), args: exactObject(args) })
}

export const HostRequestSchema = v.variant('cmd', [
  request('ping', {}),
  request('listProfiles', {}),
  request('open', { profileDirectory: ProfileDirectorySchema, url: HostUrlSchema }),
  request('openTemporary', {
    profileDirectory: ProfileDirectorySchema,
    url: HostUrlSchema,
    name: v.optional(ContainerNameSchema),
  }),
  request('createProfile', {}),
  request('pair.start', { installationId: IdSchema, token: v.optional(TokenSchema) }),
  request('pair.join', { installationId: IdSchema, code: PairCodeSchema }),
  request('pair.declare', {
    token: TokenSchema,
    profileDirectory: ProfileDirectorySchema,
    identityId: v.optional(IdSchema),
  }),
  request('pair.list', { token: TokenSchema }),
  request('pair.remove', { token: TokenSchema, installationId: IdSchema }),
  request('pair.verify', { token: TokenSchema }),
  request('pair.prove', { token: TokenSchema, nonce: NonceSchema }),
  request('sync.get', { token: TokenSchema }),
  request('sync.put', {
    token: TokenSchema,
    baseRevision: RevisionSchema,
    data: LauncherDataSchema,
    bindings: BindingsSchema,
  }),
  request('icons.get', { token: TokenSchema, key: IconKeySchema }),
  request('icons.put', { token: TokenSchema, key: IconKeySchema, mime: IconMimeSchema, base64: Base64Schema }),
  request('icons.delete', { token: TokenSchema, key: IconKeySchema }),
])

export type HostRequest = v.InferOutput<typeof HostRequestSchema>
export type HostCommand = HostRequest['cmd']
export type HostArgs<C extends HostCommand> = Extract<HostRequest, { cmd: C }>['args']

const Empty = exactObject({})
const InstallationSchema = v.strictObject({
  installationId: IdSchema,
  identityId: v.optional(IdSchema),
  profileDirectory: v.optional(ProfileDirectorySchema),
  pairedAt: TimestampSchema,
  verifiedAt: v.optional(TimestampSchema),
  self: v.boolean(),
})

export const HOST_RESULT_SCHEMAS = {
  ping: v.strictObject({
    hostVersion: v.pipe(v.string(), v.maxLength(32)),
    protocol: v.literal(PROTOCOL_VERSION),
    browser: v.picklist(['brave', 'chrome', 'edge']),
    browserVersion: v.optional(v.pipe(v.string(), v.maxLength(32))),
    features: v.strictObject({ temporaryContainer: v.boolean() }),
  }),
  listProfiles: v.strictObject({ profiles: v.pipe(v.array(ProfileInfoSchema), v.maxLength(500)) }),
  open: Empty,
  openTemporary: Empty,
  createProfile: v.strictObject({ directory: ProfileDirectorySchema }),
  'pair.start': v.strictObject({ code: PairCodeSchema, expiresAt: TimestampSchema, token: v.optional(TokenSchema) }),
  'pair.join': v.strictObject({ token: TokenSchema }),
  'pair.declare': Empty,
  'pair.list': v.strictObject({
    maxPairedProfiles: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(16)),
    installations: v.pipe(v.array(InstallationSchema), v.maxLength(16)),
  }),
  'pair.remove': Empty,
  'pair.verify': v.strictObject({ expiresAt: TimestampSchema }),
  'pair.prove': v.strictObject({ verifiedAt: TimestampSchema }),
  'sync.get': v.strictObject({
    revision: RevisionSchema,
    data: v.nullable(LauncherDataSchema),
    bindings: BindingsSchema,
  }),
  'sync.put': v.strictObject({ revision: RevisionSchema }),
  'icons.get': v.strictObject({ key: IconKeySchema, mime: IconMimeSchema, base64: Base64Schema }),
  'icons.put': Empty,
  'icons.delete': Empty,
} satisfies Record<HostCommand, v.GenericSchema>

export const HOST_COMMANDS = Object.keys(HOST_RESULT_SCHEMAS) as HostCommand[]

export type HostResult<C extends HostCommand> = v.InferOutput<(typeof HOST_RESULT_SCHEMAS)[C]>

// Códigos estables que el host en Go devuelve (contrato, F1-B). "bad_code" no distingue entre código
// incorrecto, caducado o usado, para no dar pistas a quien prueba códigos (T15).
export const HOST_ERROR_CODES = [
  'bad_request',
  'unsupported_version',
  'unknown_command',
  'too_large',
  'bad_url',
  'bad_name',
  'name_in_use',
  'unknown_profile',
  'unsupported_browser',
  'not_paired',
  'bad_code',
  'limit_reached',
  'conflict',
  'bad_nonce',
  'not_found',
  'launch_failed',
  'internal',
] as const
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number]

export const HostErrorResponseSchema = v.strictObject({
  ok: v.literal(false),
  error: v.strictObject({ code: v.picklist(HOST_ERROR_CODES), revision: v.optional(RevisionSchema) }),
})

export interface HostFailure {
  readonly code: HostErrorCode | 'bad_response'
  readonly revision?: number
}

export function hostRequest<C extends HostCommand>(cmd: C, args: HostArgs<C>): { v: 1; cmd: C; args: HostArgs<C> } {
  return { v: PROTOCOL_VERSION, cmd, args }
}

// parseHostResponse valida lo que devuelve el host antes de usarlo: un host antiguo o roto no puede
// colar campos inesperados en el SW.
export function parseHostResponse<C extends HostCommand>(cmd: C, raw: unknown): Result<HostResult<C>, HostFailure> {
  const failure = v.safeParse(HostErrorResponseSchema, raw)
  if (failure.success) return err(failure.output.error)
  const success = v.safeParse(v.strictObject({ ok: v.literal(true), result: HOST_RESULT_SCHEMAS[cmd] }), raw)
  return success.success ? ok(success.output.result as HostResult<C>) : err({ code: 'bad_response' })
}
