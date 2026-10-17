import {
  BindingHintsSchema,
  BindingSchema,
  boundedArray,
  IdSchema,
  LabelSchema,
  LauncherDataSchema,
  MAX_URL_LENGTH,
  OpSchema,
  ProfileDirectorySchema,
  RevisionSchema,
  type Binding,
  type LauncherData,
  type ProfileInfo,
} from '@account-launcher/core'
import * as v from 'valibot'
import { ContainerNameSchema, PairCodeSchema, type HostErrorCode, type HostResult } from './host'
import { IconImageSchema, UploadedIconKeySchema, type IconImage } from './icons'

// Mensajes del dashboard al service worker. El SW los valida y comprueba sender.id (T1).
export const UiRequestSchema = v.variant('type', [
  v.strictObject({ type: v.literal('account.open'), accountId: IdSchema, asIdentityId: v.optional(IdSchema) }),
  v.strictObject({
    type: v.literal('account.openTemporary'),
    target: v.variant('kind', [
      v.strictObject({ kind: v.literal('account'), accountId: IdSchema }),
      // Aquí solo se acota el tamaño. El SW debe pasar target.url por normalizeUrl, con el allowHttp del usuario,
      // antes de enviarla al host: el host exige la forma canónica pero acepta http siempre (allowHttp es del core).
      v.strictObject({ kind: v.literal('url'), url: v.pipe(v.string(), v.maxLength(MAX_URL_LENGTH)) }),
    ]),
    name: v.optional(ContainerNameSchema),
  }),
  v.strictObject({ type: v.literal('capabilities.get') }),
  v.strictObject({ type: v.literal('profiles.list') }),
  // name acaba en el desiredName del vínculo: es el mismo esquema de etiqueta de core.
  v.strictObject({ type: v.literal('profiles.create'), identityId: IdSchema, name: LabelSchema }),
  v.strictObject({ type: v.literal('host.ping') }),
  v.strictObject({ type: v.literal('data.get') }),
  v.strictObject({
    type: v.literal('data.mutate'),
    revision: RevisionSchema,
    // El tope va antes de validar cada operación (boundedArray), como pide la lista de calidad.
    ops: v.pipe(boundedArray(OpSchema, 100), v.minLength(1)),
  }),
  // Importación de una vez (§5.4): el dashboard ya pasó el archivo por parseImport. El SW valida y combina con
  // planImport, guarda la copia data.backup, aplica todo de una vez y revincula con rebindFromHints.
  v.pipe(
    v.strictObject({
      type: v.literal('data.import'),
      revision: RevisionSchema,
      mode: v.picklist(['merge', 'replace']),
      data: LauncherDataSchema,
      bindingHints: v.optional(BindingHintsSchema),
    }),
    // Igual que parseImport: una sola pista por identidad. Las de identidades desconocidas las ignora el SW.
    v.check((request) => {
      const seen = new Set<string>()
      for (const hint of request.bindingHints ?? []) {
        if (seen.has(hint.identityId)) return false
        seen.add(hint.identityId)
      }
      return true
    }, 'pistas repetidas'),
  ),
  v.strictObject({ type: v.literal('bindings.get') }),
  v.strictObject({ type: v.literal('bindings.set'), identityId: IdSchema, binding: v.nullable(BindingSchema) }),
  v.strictObject({ type: v.literal('pair.start') }),
  v.strictObject({ type: v.literal('pair.join'), code: PairCodeSchema }),
  v.strictObject({
    type: v.literal('pair.declare'),
    profileDirectory: ProfileDirectorySchema,
    identityId: v.optional(IdSchema),
  }),
  v.strictObject({ type: v.literal('pair.list') }),
  v.strictObject({ type: v.literal('pair.remove'), installationId: IdSchema }),
  v.strictObject({ type: v.literal('pair.verify') }),
  v.strictObject({ type: v.literal('sync.refresh') }),
  // Imágenes subidas como icono (T5). Con datos locales van a storage.local; con la instalación emparejada, al host.
  v.strictObject({ type: v.literal('icon.get'), key: UploadedIconKeySchema }),
  v.pipe(
    v.strictObject({
      type: v.literal('icon.put'),
      key: UploadedIconKeySchema,
      mime: IconImageSchema.entries.mime,
      base64: IconImageSchema.entries.base64,
    }),
    // Bytes mágicos, base64 canónico y tamaño: la comprobación de IconImageSchema sobre el mensaje.
    v.check((request) => v.is(IconImageSchema, { mime: request.mime, base64: request.base64 }), 'imagen no válida'),
  ),
  v.strictObject({ type: v.literal('icon.delete'), key: UploadedIconKeySchema }),
])

export type UiRequest = v.InferOutput<typeof UiRequestSchema>
export type UiRequestType = UiRequest['type']

export const UI_ERROR_CODES = [
  'invalid',
  'not_found',
  'conflict',
  'host_missing',
  'host_error',
  'unavailable',
  'internal',
] as const
export type UiErrorCode = (typeof UI_ERROR_CODES)[number] | HostErrorCode

export interface UiError {
  readonly code: UiErrorCode
  // Texto de ayuda para la UI (clave de traducción), nunca datos del usuario.
  readonly hint?: string
}

export type UiResponse<T> = { readonly ok: true; readonly result: T } | { readonly ok: false; readonly error: UiError }

export type ProviderId = 'current' | 'chromium-profile' | 'brave-temporary-container'
export type UnavailableReason = 'single_mode' | 'host_missing' | 'host_outdated' | 'unsupported_browser'

export interface Capabilities {
  readonly mode: 'single' | 'multi'
  readonly host: { readonly available: false } | { readonly available: true; readonly ping: HostResult<'ping'> }
  readonly providers: readonly {
    readonly id: ProviderId
    readonly available: boolean
    readonly reason?: UnavailableReason
  }[]
}

type Empty = Record<string, never>

// Resultado de cada petición. Solo tipos: emisor y receptor son la misma extensión.
export interface UiResults {
  'account.open': { readonly provider: ProviderId }
  'account.openTemporary': Empty
  'capabilities.get': Capabilities
  'profiles.list': { readonly profiles: readonly ProfileInfo[] }
  'profiles.create': { readonly directory: string }
  'host.ping': HostResult<'ping'>
  'data.get': { readonly data: LauncherData; readonly source: 'local' | 'shared' }
  'data.mutate': { readonly revision: number }
  // Recuentos de planImport e identidades sin revincular (la UI pide resolverlas).
  'data.import': {
    readonly revision: number
    readonly added: number
    readonly updated: number
    readonly unchanged: number
    readonly removed: number
    readonly unresolved: readonly string[]
  }
  'bindings.get': { readonly bindings: Readonly<Record<string, Binding>> }
  'bindings.set': Empty
  'pair.start': { readonly code: string; readonly expiresAt: string }
  'pair.join': Empty
  'pair.declare': Empty
  'pair.list': HostResult<'pair.list'>
  'pair.remove': Empty
  'pair.verify': { readonly expiresAt: string }
  'sync.refresh': { readonly revision: number }
  'icon.get': IconImage
  'icon.put': Empty
  'icon.delete': Empty
}
