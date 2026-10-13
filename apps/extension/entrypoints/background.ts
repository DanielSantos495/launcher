import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { createHostClient } from '../src/background/host-client'
import { createQueue } from '../src/background/queue'
import { createRouter } from '../src/background/router'
import { openOrFocusDashboard } from '../src/platform/dashboard-tab'
import { createBrowserSwDeps } from '../src/platform/sw-deps'

// Todos los listeners se registran de forma síncrona al arrancar el service worker.
export default defineBackground(() => {
  const deps = createBrowserSwDeps()
  // Sin host (undefined) si el navegador no es Brave, Chrome ni Edge: "Varios perfiles" queda sin proveedores.
  const route = createRouter({ deps, queue: createQueue(), host: createHostClient(deps) })

  // Responder de forma asíncrona exige devolver true para que el canal siga abierto.
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    void route(message, { id: sender.id, url: sender.url }).then(sendResponse)
    return true
  })
  browser.action.onClicked.addListener(() => {
    openOrFocusDashboard().catch(() => undefined)
  })
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') openOrFocusDashboard().catch(() => undefined)
  })
})
