import {
  HOST_ERROR_CODES,
  UI_ERROR_CODES,
  type UiRequest,
  type UiResponse,
  type UiResults,
} from '@account-launcher/protocol'
import * as v from 'valibot'
import { InstallationSchema } from '../storage/installation'
import { LOCAL_KEYS, SESSION_KEYS } from '../storage/keys'

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

// Claves de storage cuyo cambio puede alterar lo que muestra el dashboard.
const WATCHED: Readonly<Record<'local' | 'session', ReadonlySet<string>>> = {
  local: new Set([LOCAL_KEYS.localData, LOCAL_KEYS.localBindings, LOCAL_KEYS.installation]),
  session: new Set([SESSION_KEYS.shared]),
}

export function isRelevantChange(areaName: string, keys: Iterable<string>): boolean {
  if (areaName !== 'local' && areaName !== 'session') return false
  const watched = WATCHED[areaName]
  for (const key of keys) if (watched.has(key)) return true
  return false
}
