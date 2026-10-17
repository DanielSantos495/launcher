import { browser } from 'wxt/browser'
import { LOCAL_KEYS } from '../storage/keys'
import { backupSize, isRelevantChange, parseInstallation, toUiResponse, type LauncherClient } from '../ui/client'

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
        const stored = await browser.storage.local.get(LOCAL_KEYS.backup)
        return backupSize(Object.hasOwn(stored, LOCAL_KEYS.backup) ? stored[LOCAL_KEYS.backup] : undefined)
      } catch {
        return 0
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
