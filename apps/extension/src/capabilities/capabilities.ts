import type { Capabilities, ProviderId, UnavailableReason } from '@account-launcher/protocol'
import type { HostCallError, HostClient } from '../background/host-client'
import { PING_TIMEOUT_MS } from '../background/host-client'
import type { Mode } from '../background/mode'

type ProviderEntry = Capabilities['providers'][number]

const current: ProviderEntry = { id: 'current', available: true }

function unavailable(id: ProviderId, reason: UnavailableReason): ProviderEntry {
  return { id, available: false, reason }
}

// Sin host utilizable, `current` sigue disponible y los otros dos comparten el motivo.
function withoutHost(mode: Mode, reason: UnavailableReason): Capabilities {
  return {
    mode,
    host: { available: false },
    providers: [current, unavailable('chromium-profile', reason), unavailable('brave-temporary-container', reason)],
  }
}

// Un host antiguo (versión de protocolo distinta o respuesta fuera del contrato) pide actualizarlo; todo lo demás
// (no instalado, sin permiso, sin respuesta a tiempo, terminado o con un error inesperado) pide instalarlo.
function reasonFor(error: HostCallError): UnavailableReason {
  const outdated =
    error.code === 'unsupported_version' || (error.code === 'host_error' && error.hint === 'bad_response')
  return outdated ? 'host_outdated' : 'host_missing'
}

// Capacidades del momento (§1, §8): en "Perfil único" no se pregunta al host (nada que instalar); en "Varios perfiles"
// un ping decide qué proveedores hay. El contenedor temporal solo existe en Brave y si el host lo anuncia.
export async function getCapabilities(mode: Mode, host: HostClient | undefined): Promise<Capabilities> {
  if (mode === 'single') return withoutHost(mode, 'single_mode')
  if (host === undefined) return withoutHost(mode, 'unsupported_browser')
  const pinged = await host.call('ping', {}, { timeoutMs: PING_TIMEOUT_MS })
  if (!pinged.ok) return withoutHost(mode, reasonFor(pinged.error))
  const ping = pinged.value
  const temporary = ping.browser === 'brave' && ping.features.temporaryContainer
  return {
    mode,
    host: { available: true, ping },
    providers: [
      current,
      { id: 'chromium-profile', available: true },
      temporary
        ? { id: 'brave-temporary-container', available: true }
        : unavailable('brave-temporary-container', 'unsupported_browser'),
    ],
  }
}
