import type { Result } from '@account-launcher/core'
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
import { toUiError } from './host-client'
import { getBindings, getData, mutateData, setBinding } from './handlers/data'
import { capabilitiesGet, hostPing } from './handlers/capabilities'
import { iconDelete, iconGet, iconPut } from './handlers/icons'
import { importData } from './handlers/import'
import { openAccount, openTemporary } from './handlers/open'
import {
  pairDeclare,
  pairJoin,
  pairList,
  pairRemove,
  pairStart,
  pairVerify,
  syncRefresh,
  whoamiProve,
} from './handlers/pairing'
import { profilesCreate, profilesList } from './handlers/profiles'
import type { Handler } from './handlers/types'
import { uiError } from './hints'
import { WhoamiProveSchema } from './internal-messages'

export interface SenderInfo {
  readonly id?: string | undefined
  readonly url?: string | undefined
}

type Handlers = { readonly [K in UiRequestType]: Handler<K> }

const LAUNCHER_PATH = '/launcher.html'
// La página whoami (§4.7) solo puede enviar whoami.prove (DC6) y el dashboard no puede enviarlo.
const WHOAMI_PATH = '/whoami.html'
const WHOAMI_TYPE = 'whoami.prove'

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

// Tabla tipada: añadir un tipo a UiRequestSchema sin manejador no compila.
const HANDLERS: Handlers = {
  'account.open': openAccount,
  'account.openTemporary': openTemporary,
  'capabilities.get': capabilitiesGet,
  'profiles.list': profilesList,
  'profiles.create': profilesCreate,
  'host.ping': hostPing,
  'data.get': getData,
  'data.mutate': mutateData,
  'data.import': importData,
  'bindings.get': getBindings,
  'bindings.set': setBinding,
  'pair.start': pairStart,
  'pair.join': pairJoin,
  'pair.declare': pairDeclare,
  'pair.list': pairList,
  'pair.remove': pairRemove,
  'pair.verify': pairVerify,
  'sync.refresh': syncRefresh,
  'icon.get': iconGet,
  'icon.put': iconPut,
  'icon.delete': iconDelete,
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

// Tipo declarado por el mensaje, solo para decidir qué página puede enviarlo; la validación completa va después.
function declaredType(message: unknown): unknown {
  return typeof message === 'object' && message !== null && !Array.isArray(message)
    ? Reflect.get(message, 'type')
    : undefined
}

// Frontera de confianza del service worker (T1): comprueba el remitente y valida el mensaje antes de ejecutar nada.
// Las respuestas de error solo llevan código y pista; nunca el mensaje recibido ni error.message.
export function createRouter(env: SwEnv): (message: unknown, sender: SenderInfo) => Promise<UiResponse<unknown>> {
  return async (message, sender) => {
    try {
      const pathname = senderPathname(env.deps.extensionId, sender)
      if (declaredType(message) === WHOAMI_TYPE) {
        // whoami.prove solo vale desde /whoami.html: ni el dashboard ni otra ruta de la extensión pueden enviarlo.
        if (pathname !== WHOAMI_PATH) return failure(uiError('invalid', 'sender'))
        const proof = v.safeParse(WhoamiProveSchema, message)
        if (!proof.success) return failure(uiError('invalid'))
        const proved = await whoamiProve(proof.output, env)
        return proved.ok ? { ok: true, result: proved.value } : failure(toUiError(proved.error))
      }
      // /whoami.html no puede enviar ningún otro tipo de mensaje.
      if (pathname !== LAUNCHER_PATH) return failure(uiError('invalid', 'sender'))
      const parsed = v.safeParse(UiRequestSchema, message)
      if (!parsed.success) return failure(uiError('invalid'))
      const result = await dispatch(parsed.output.type, parsed.output, env)
      return result.ok ? { ok: true, result: result.value } : failure(toUiError(result.error))
    } catch {
      return failure(uiError('internal'))
    }
  }
}
