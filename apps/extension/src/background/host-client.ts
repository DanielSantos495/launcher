import { err, ok, type Result } from '@account-launcher/core'
import {
  hostRequest,
  HostRequestSchema,
  MAX_HOST_REQUEST_BYTES,
  parseHostResponse,
  type HostArgs,
  type HostCommand,
  type HostResult,
  type UiError,
} from '@account-launcher/protocol'
import * as v from 'valibot'
import { jsonBytes } from '../storage/usage'
import type { SwDeps } from './deps'
import { uiError } from './hints'

// Plazo de una llamada normal al host y de la comprobación de disponibilidad (ping).
export const HOST_TIMEOUT_MS = 10_000
export const PING_TIMEOUT_MS = 3_000

// conflict (sync.put) lleva la revisión actual del host; ningún otro error la lleva.
export type HostCallError = UiError & { readonly revision?: number }

export interface HostClient {
  call<C extends HostCommand>(
    cmd: C,
    args: HostArgs<C>,
    options?: { readonly timeoutMs?: number },
  ): Promise<Result<HostResult<C>, HostCallError>>
}

type Outcome =
  | { readonly kind: 'response'; readonly raw: unknown }
  | { readonly kind: 'rejected'; readonly missing: boolean }
  | { readonly kind: 'timeout' }

// El texto de un error de Chromium solo se mira para clasificarlo; nunca se copia a la respuesta.
function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const message: unknown = Reflect.get(error, 'message')
    if (typeof message === 'string') return message
  }
  return ''
}

// "Specified native messaging host not found." y "Access to the specified native messaging host is forbidden."
// significan que el host no está instalado (o no autoriza a esta extensión).
function isMissingHost(error: unknown): boolean {
  const text = errorText(error).toLowerCase()
  return text.includes('not found') || text.includes('forbidden')
}

async function send(deps: Pick<SwDeps, 'nativeSend'>, hostName: string, request: object): Promise<Outcome> {
  try {
    return { kind: 'response', raw: await deps.nativeSend(hostName, request) }
  } catch (error) {
    return { kind: 'rejected', missing: isMissingHost(error) }
  }
}

// Único punto por el que el service worker habla con el host (T2, T3): valida la petición con el esquema del contrato
// y el tamaño antes de enviarla, limita la espera y valida la respuesta antes de devolverla. Los errores solo llevan
// código y pista, nunca el texto del error nativo ni valores recibidos.
export function createHostClient(deps: Pick<SwDeps, 'nativeSend' | 'hostName' | 'sleep'>): HostClient | undefined {
  const { hostName } = deps
  if (hostName === undefined) return undefined
  return {
    async call(cmd, args, options) {
      const request = hostRequest(cmd, args)
      if (!v.safeParse(HostRequestSchema, request).success) return err(uiError('internal', 'bad_host_request'))
      if (jsonBytes(request) > MAX_HOST_REQUEST_BYTES) return err(uiError('too_large', 'request_too_large'))

      const timeout = deps.sleep(options?.timeoutMs ?? HOST_TIMEOUT_MS).then((): Outcome => ({ kind: 'timeout' }))
      const outcome = await Promise.race([send(deps, hostName, request), timeout])
      if (outcome.kind === 'timeout') return err(uiError('host_error', 'timeout'))
      if (outcome.kind === 'rejected') {
        return err(outcome.missing ? uiError('host_missing') : uiError('host_error', 'host_failed'))
      }

      const parsed = parseHostResponse(cmd, outcome.raw)
      if (parsed.ok) return ok(parsed.value)
      const { code, revision } = parsed.error
      if (code === 'bad_response') return err(uiError('host_error', 'bad_response'))
      return err(revision === undefined ? uiError(code) : { ...uiError(code), revision })
    },
  }
}
