import { err, ok, type Result } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import type { SwDeps } from '../background/deps'
import { uiError } from '../background/hints'

export interface CurrentProvider {
  open(url: string): Promise<Result<undefined, UiError>>
}

// Proveedores de apertura. `current` abre en una pestaña nueva del navegador actual. Sin opener (T10): openTab
// llama a tabs.create y la pestaña no hereda nada de la página que la pidió.
export function createProviders(deps: SwDeps): { readonly current: CurrentProvider } {
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
  }
}
