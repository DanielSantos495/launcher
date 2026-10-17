import { browser } from 'wxt/browser'
import { parseIconIndex } from '../storage/icon-index'
import { LOCAL_KEYS } from '../storage/keys'
import {
  backupSize,
  imagesSize,
  isRelevantChange,
  parseInstallation,
  parseSeenProfiles,
  toUiResponse,
  type LauncherClient,
} from '../ui/client'

// Cliente del dashboard sobre la API del navegador. Es el único sitio que une la UI con wxt/browser.
export function createBrowserClient(): LauncherClient {
  return {
    async send(request) {
      try {
        const raw: unknown = await browser.runtime.sendMessage(request)
        return toUiResponse<typeof request>(raw)
      } catch {
        // El service worker no respondió (por ejemplo, la extensión se está recargando).
        return { ok: false, error: { code: 'internal' } }
      }
    },
    async installation() {
      try {
        const stored = await browser.storage.local.get(LOCAL_KEYS.installation)
        return parseInstallation(
          Object.hasOwn(stored, LOCAL_KEYS.installation) ? stored[LOCAL_KEYS.installation] : undefined,
        )
      } catch {
        return undefined
      }
    },
    async backupBytes() {
      try {
        const stored = await browser.storage.local.get([LOCAL_KEYS.backup, LOCAL_KEYS.seenProfiles])
        const own = (key: string): unknown => (Object.hasOwn(stored, key) ? stored[key] : undefined)
        return backupSize(own(LOCAL_KEYS.backup), own(LOCAL_KEYS.seenProfiles))
      } catch {
        return 0
      }
    },
    async imageBytes() {
      try {
        const index = (await browser.storage.local.get(LOCAL_KEYS.iconIndex))[LOCAL_KEYS.iconIndex]
        const keys = parseIconIndex(index) ?? []
        return imagesSize(index, keys.length === 0 ? {} : await browser.storage.local.get(keys))
      } catch {
        return 0
      }
    },
    async seenProfiles() {
      try {
        const stored = await browser.storage.local.get(LOCAL_KEYS.seenProfiles)
        return parseSeenProfiles(
          Object.hasOwn(stored, LOCAL_KEYS.seenProfiles) ? stored[LOCAL_KEYS.seenProfiles] : undefined,
        )
      } catch {
        return undefined
      }
    },
    async saveSeenProfiles(directories) {
      try {
        await browser.storage.local.set({ [LOCAL_KEYS.seenProfiles]: directories })
      } catch {
        // Sin guardar, el aviso volverá a salir: es mejor que romper la pantalla.
      }
    },
    subscribe(listener) {
      const onChanged = (changes: Record<string, unknown>, areaName: string): void => {
        if (isRelevantChange(areaName, Object.keys(changes))) listener()
      }
      browser.storage.onChanged.addListener(onChanged)
      return () => {
        browser.storage.onChanged.removeListener(onChanged)
      }
    },
  }
}
