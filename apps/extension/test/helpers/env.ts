import { createHostClient, PING_TIMEOUT_MS } from '../../src/background/host-client'
import { createQueue } from '../../src/background/queue'
import { createRouter } from '../../src/background/router'
import type { SwDeps, SwEnv } from '../../src/background/deps'
import type { UiResponse } from '@account-launcher/protocol'
import type { FakeHost } from './fake-host'
import { createMemoryArea, type MemoryArea } from './memory-area'

export const EXTENSION_ID = 'lkiagpaidnmkiaabacdcmfkfhmjloocf'
export const LAUNCHER_URL = `chrome-extension://${EXTENSION_ID}/launcher.html`
export const DEFAULT_NOW = '2026-10-08T12:00:00.000Z'

export interface TestEnvOptions {
  // Contenido inicial de storage.local.
  readonly local?: Record<string, unknown>
  readonly now?: string
  // Host falso: su send hace de nativeSend y su hostName de hostName. Sin él no hay host (navegador no reconocido).
  readonly host?: FakeHost
  readonly sleep?: (ms: number) => Promise<void>
}

export interface TestEnv {
  readonly env: SwEnv
  readonly deps: SwDeps & { opened: string[] }
  readonly local: MemoryArea
  readonly session: MemoryArea
  // Envía un mensaje como el dashboard (o desde la url indicada) y devuelve la respuesta del router.
  route(message: unknown, url?: string): Promise<UiResponse<unknown>>
}

// Pausas cortas (como las de profiles.create) inmediatas; los plazos de las llamadas al host (3 s y 10 s) no vencen
// nunca, para que la respuesta del falso no compita con ellos. Quien pruebe un plazo vencido pasa su propio sleep.
function defaultSleep(ms: number): Promise<void> {
  return ms < PING_TIMEOUT_MS ? Promise.resolve() : new Promise<void>(() => undefined)
}

// Entorno determinista: reloj fijo, ids id-1, id-2…, sleep de defaultSleep y almacenamiento en memoria.
export function createTestEnv(options: TestEnvOptions = {}): TestEnv {
  const local = createMemoryArea(options.local)
  const session = createMemoryArea()
  const opened: string[] = []
  let counter = 0
  const deps: SwDeps & { opened: string[] } = {
    local,
    session,
    opened,
    nativeSend:
      options.host?.send ??
      (() => Promise.reject(new Error('nativeSend no está disponible en este entorno de prueba'))),
    hostName: options.host?.hostName,
    openTab: (url) => {
      opened.push(url)
      return Promise.resolve()
    },
    now: () => new Date(options.now ?? DEFAULT_NOW),
    randomId: () => {
      counter++
      return `id-${String(counter)}`
    },
    sleep: options.sleep ?? defaultSleep,
    extensionId: EXTENSION_ID,
  }
  const env: SwEnv = { deps, queue: createQueue(), host: createHostClient(deps) }
  const router = createRouter(env)
  return {
    env,
    deps,
    local,
    session,
    route: (message, url = LAUNCHER_URL) => router(message, { id: EXTENSION_ID, url }),
  }
}
