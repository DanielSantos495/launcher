import { err, ok, type Result } from '@account-launcher/core'
import type { Capabilities, ProviderId, UiError } from '@account-launcher/protocol'
import type { SwDeps } from '../background/deps'
import { uiError } from '../background/hints'
import type { HostClient } from '../background/host-client'

export interface CurrentProvider {
  open(url: string): Promise<Result<undefined, UiError>>
}

export interface ChromiumProfileProvider {
  open(url: string, profileDirectory: string): Promise<Result<undefined, UiError>>
}

export interface BraveTemporaryContainerProvider {
  open(url: string, profileDirectory: string, name?: string): Promise<Result<undefined, UiError>>
}

export interface Providers {
  readonly current: CurrentProvider
  readonly chromiumProfile: ChromiumProfileProvider
  readonly braveTemporaryContainer: BraveTemporaryContainerProvider
  // Lee lo que getCapabilities calculó: la disponibilidad se decide en un solo sitio.
  available(id: ProviderId, caps: Capabilities): boolean
}

// Proveedores de apertura. `current` abre en una pestaña nueva del navegador actual. Sin opener (T10): openTab
// llama a tabs.create y la pestaña no hereda nada de la página que la pidió. Los otros dos pasan por el host, que es
// quien lanza el navegador; la URL ya viene normalizada (HostClient la vuelve a validar contra el contrato).
export function createProviders(deps: SwDeps, host: HostClient | undefined): Providers {
  return {
    current: {
      async open(url) {
        try {
          await deps.openTab(url)
          return ok(undefined)
        } catch {
          return err(uiError('internal', 'open_failed'))
        }
      },
    },
    chromiumProfile: {
      async open(url, profileDirectory) {
        if (host === undefined) return err(uiError('unavailable', 'unsupported_browser'))
        const launched = await host.call('open', { profileDirectory, url })
        return launched.ok ? ok(undefined) : err(launched.error)
      },
    },
    braveTemporaryContainer: {
      async open(url, profileDirectory, name) {
        if (host === undefined) return err(uiError('unavailable', 'unsupported_browser'))
        // La clave name solo existe si hay nombre: el host rechaza un null y el contrato no admite undefined explícito.
        const args = name === undefined ? { profileDirectory, url } : { profileDirectory, url, name }
        const launched = await host.call('openTemporary', args)
        return launched.ok ? ok(undefined) : err(launched.error)
      },
    },
    available(id, caps) {
      return caps.providers.some((provider) => provider.id === id && provider.available)
    },
  }
}
