import { ok } from '@account-launcher/core'
import { getCapabilities } from '../../capabilities/capabilities'
import { inContext, requireHost } from '../context'
import { PING_TIMEOUT_MS } from '../host-client'
import type { Handler } from './types'

// El modo se lee dentro de la cola; la consulta al host va fuera de ella para que un host lento no bloquee las
// lecturas y escrituras de datos.
export const capabilitiesGet: Handler<'capabilities.get'> = async (_request, env) => {
  const mode = await inContext(env, (context) => ok(context.mode))
  if (!mode.ok) return mode
  return ok(await getCapabilities(mode.value, env.host))
}

export const hostPing: Handler<'host.ping'> = async (_request, env) => {
  const host = await inContext(env, (context) => requireHost(context.mode, env.host))
  if (!host.ok) return host
  return host.value.call('ping', {}, { timeoutMs: PING_TIMEOUT_MS })
}
