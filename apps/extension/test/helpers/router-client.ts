import { LOCAL_KEYS } from '../../src/storage/keys'
import { parseIconIndex } from '../../src/storage/icon-index'
import {
  backupSize,
  imagesSize,
  isRelevantChange,
  parseInstallation,
  toUiResponse,
  type LauncherClient,
} from '../../src/ui/client'
import type { TestEnv } from './env'

// LauncherClient sobre el router real del service worker y el almacenamiento en memoria: lo que ve el dashboard en
// producción, sin navegador. subscribe avisa con los mismos cambios que storage.onChanged (local y de sesión).
export function createRouterClient(testEnv: TestEnv): LauncherClient {
  return {
    async send(request) {
      return toUiResponse<typeof request>(await testEnv.route(request))
    },
    async installation() {
      return parseInstallation(await testEnv.local.get(LOCAL_KEYS.installation))
    },
    async backupBytes() {
      return backupSize(await testEnv.local.get(LOCAL_KEYS.backup))
    },
    async imageBytes() {
      const index = await testEnv.local.get(LOCAL_KEYS.iconIndex)
      const stored: Record<string, unknown> = {}
      for (const key of parseIconIndex(index) ?? []) stored[key] = await testEnv.local.get(key)
      return imagesSize(index, stored)
    },
    subscribe(listener) {
      const offLocal = testEnv.local.onChange((keys) => {
        if (isRelevantChange('local', keys)) listener()
      })
      const offSession = testEnv.session.onChange((keys) => {
        if (isRelevantChange('session', keys)) listener()
      })
      return () => {
        offLocal()
        offSession()
      }
    },
  }
}
