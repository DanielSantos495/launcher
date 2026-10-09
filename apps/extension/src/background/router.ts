import { err, type Result } from '@account-launcher/core'
import {
  UiRequestSchema,
  type UiError,
  type UiRequest,
  type UiRequestType,
  type UiResponse,
  type UiResults,
} from '@account-launcher/protocol'
import * as v from 'valibot'
import type { SwEnv } from './deps'
import { getBindings, getData, mutateData, setBinding } from './handlers/data'
import { openAccount } from './handlers/open'
import { uiError } from './hints'

export interface SenderInfo {
  readonly id?: string | undefined
  readonly url?: string | undefined
}

export type Handler<K extends UiRequestType> = (
  request: Extract<UiRequest, { type: K }>,
  env: SwEnv,
) => Promise<Result<UiResults[K], UiError>>

type Handlers = { readonly [K in UiRequestType]: Handler<K> }

const LAUNCHER_PATH = '/launcher.html'

// Devuelve la ruta de la página que envía el mensaje, o undefined si el remitente no es una página de esta
// extensión. sender.id solo no basta (T1): también debe coincidir el origen de sender.url.
// Se compara esquema y host en lugar de URL.origin porque Node (donde corren las pruebas) da "null" como origen de
// chrome-extension:, y el navegador da chrome-extension://<id>. Credenciales o puerto en la URL no valen.
function senderPathname(extensionId: string, sender: SenderInfo): string | undefined {
  if (sender.id !== extensionId || sender.url === undefined) return undefined
  let url: URL
  try {
    url = new URL(sender.url)
  } catch {
    return undefined
  }
  const sameOrigin =
    url.protocol === 'chrome-extension:' && url.host === extensionId && url.username === '' && url.password === ''
  return sameOrigin ? url.pathname : undefined
}

function notImplemented(): Promise<Result<never, UiError>> {
  return Promise.resolve(err(uiError('unavailable', 'not_implemented')))
}

// Tabla tipada: añadir un tipo a UiRequestSchema sin manejador no compila.
const HANDLERS: Handlers = {
  'account.open': openAccount,
  'account.openTemporary': notImplemented,
  'capabilities.get': notImplemented,
  'profiles.list': notImplemented,
  'profiles.create': notImplemented,
  'host.ping': notImplemented,
  'data.get': getData,
  'data.mutate': mutateData,
  'data.import': notImplemented,
  'bindings.get': getBindings,
  'bindings.set': setBinding,
  'pair.start': notImplemented,
  'pair.join': notImplemented,
  'pair.declare': notImplemented,
  'pair.list': notImplemented,
  'pair.remove': notImplemented,
  'pair.verify': notImplemented,
  'sync.refresh': notImplemented,
}

function dispatch<K extends UiRequestType>(
  type: K,
  request: Extract<UiRequest, { type: K }>,
  env: SwEnv,
): Promise<Result<UiResults[K], UiError>> {
  return HANDLERS[type](request, env)
}

function failure(error: UiError): UiResponse<never> {
  return { ok: false, error }
}

// Frontera de confianza del service worker (T1): comprueba el remitente y valida el mensaje antes de ejecutar nada.
// Las respuestas de error solo llevan código y pista; nunca el mensaje recibido ni error.message.
export function createRouter(env: SwEnv): (message: unknown, sender: SenderInfo) => Promise<UiResponse<unknown>> {
  return async (message, sender) => {
    try {
      if (senderPathname(env.deps.extensionId, sender) !== LAUNCHER_PATH) return failure(uiError('invalid', 'sender'))
      const parsed = v.safeParse(UiRequestSchema, message)
      if (!parsed.success) return failure(uiError('invalid'))
      const result = await dispatch(parsed.output.type, parsed.output, env)
      return result.ok ? { ok: true, result: result.value } : failure(result.error)
    } catch {
      return failure(uiError('internal'))
    }
  }
}
