import {
  HOST_ERROR_CODES,
  UI_ERROR_CODES,
  type UiRequest,
  type UiResponse,
  type UiResults,
} from '@account-launcher/protocol'
import * as v from 'valibot'
import { parseIconIndex } from '../storage/icon-index'
import { InstallationSchema } from '../storage/installation'
import { LOCAL_KEYS, SESSION_KEYS } from '../storage/keys'
import { jsonBytes } from '../storage/usage'

export interface InstallationView {
  readonly installationId: string
  readonly paired: boolean
  readonly ownIdentityId?: string
  readonly ownProfileDirectory?: string
}

// Lo único que el dashboard necesita del navegador. Ninguno de los métodos rechaza: send convierte un fallo del canal
// en { ok: false, error: { code: 'internal' } } e installation devuelve undefined si no se puede leer o no valida.
export interface LauncherClient {
  send<R extends UiRequest>(request: R): Promise<UiResponse<UiResults[R['type']]>>
  installation(): Promise<InstallationView | undefined> // lee y valida LOCAL_KEYS.installation (InstallationSchema)
  backupBytes(): Promise<number> // bytes UTF-8 del JSON de LOCAL_KEYS.backup; 0 si no hay o no se puede leer
  imageBytes(): Promise<number> // bytes de las imágenes de storage.local (LOCAL_KEYS.iconIndex); 0 si no hay
  subscribe(listener: () => void): () => void // storage.onChanged: localData, localBindings, installation, shared
}

const UiErrorSchema = v.strictObject({
  code: v.picklist([...UI_ERROR_CODES, ...HOST_ERROR_CODES]),
  hint: v.optional(v.string()),
})

const ResponseSchema = v.union([
  v.strictObject({ ok: v.literal(true), result: v.unknown() }),
  v.strictObject({ ok: v.literal(false), error: UiErrorSchema }),
])

// La respuesta del service worker llega sin tipo: solo un sobre bien formado cuenta; cualquier otra cosa es internal.
// El resultado de una respuesta correcta lo valida el router del service worker, que es la misma extensión.
export function toUiResponse<R extends UiRequest>(raw: unknown): UiResponse<UiResults[R['type']]> {
  const parsed = v.safeParse(ResponseSchema, raw)
  if (!parsed.success) return { ok: false, error: { code: 'internal' } }
  // Única conversión de tipo del cliente: el tipo del resultado depende del mensaje enviado, que el sobre no lleva.
  return parsed.output as UiResponse<UiResults[R['type']]>
}

// Instalación guardada en storage.local, o undefined si falta o no valida. Nunca lee `pairing` (DC5).
export function parseInstallation(raw: unknown): InstallationView | undefined {
  const parsed = v.safeParse(InstallationSchema, raw)
  return parsed.success ? parsed.output : undefined
}

// Bytes que ocupa lo guardado como copia de seguridad (0 si no hay): cuentan para la cuota de storage.local.
export function backupSize(raw: unknown): number {
  return raw === undefined ? 0 : jsonBytes(raw)
}

// Bytes de las imágenes del índice que hay en `stored` (las que faltan no cuentan); 0 si el índice no es válido.
export function imagesSize(index: unknown, stored: Readonly<Record<string, unknown>>): number {
  let bytes = 0
  for (const key of parseIconIndex(index) ?? []) {
    if (Object.hasOwn(stored, key)) bytes += jsonBytes(stored[key])
  }
  return bytes
}

// Claves de storage cuyo cambio puede alterar lo que muestra el dashboard.
const WATCHED: Readonly<Record<'local' | 'session', ReadonlySet<string>>> = {
  local: new Set([
    LOCAL_KEYS.localData,
    LOCAL_KEYS.localBindings,
    LOCAL_KEYS.installation,
    LOCAL_KEYS.backup,
    LOCAL_KEYS.iconIndex,
  ]),
  session: new Set([SESSION_KEYS.shared]),
}

export function isRelevantChange(areaName: string, keys: Iterable<string>): boolean {
  if (areaName !== 'local' && areaName !== 'session') return false
  const watched = WATCHED[areaName]
  for (const key of keys) if (watched.has(key)) return true
  return false
}
