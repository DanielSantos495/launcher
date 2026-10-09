import { browser } from 'wxt/browser'
import type { KeyValueArea, SwDeps } from '../background/deps'
import { hostNameFor, readBrands } from './host-name'

// get(key) devuelve undefined si la clave no existe: así no se confunde una clave propia con una heredada.
function areaOf(storage: typeof browser.storage.local): KeyValueArea {
  return {
    async get(key) {
      const result = await storage.get(key)
      const value: unknown = Object.hasOwn(result, key) ? result[key] : undefined
      return value
    },
    set: (items) => storage.set({ ...items }),
    remove: (keys) => storage.remove([...keys]),
  }
}

// Dependencias reales del service worker. Es el único sitio que une SwDeps con la API del navegador.
export function createBrowserSwDeps(): SwDeps {
  return {
    local: areaOf(browser.storage.local),
    session: areaOf(browser.storage.session),
    nativeSend: async (hostName, message) => {
      const response: unknown = await browser.runtime.sendNativeMessage(hostName, message)
      return response
    },
    hostName: hostNameFor(readBrands(navigator)),
    openTab: async (url) => {
      await browser.tabs.create({ url })
    },
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    extensionId: browser.runtime.id,
  }
}
