import { ok, type Result } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { ensureInstallation, readToken, type Installation } from '../storage/installation'
import { createLocalStore } from '../storage/local-store'
import type { DataStore, Snapshot } from '../storage/data-store'
import type { SwEnv } from './deps'
import type { Mode } from './mode'

// Todo lo que un manejador necesita saber de la instalación en el momento de atender un mensaje.
export interface SwContext {
  readonly installation: Installation
  readonly token: string | undefined
  readonly local: DataStore
  readonly localSnapshot: Snapshot
  readonly mode: Mode // localSnapshot.data.settings.mode (DC1)
  readonly source: 'local' | 'shared' // en esta tarea siempre 'local'; la Tarea 5 añade 'shared'
  readonly store: DataStore
}

// Crea la instalación si falta (ensureInstallation exige la cola: se llama dentro de env.queue.run) y lee el
// almacén local. Un error de lectura se devuelve tal cual.
export async function loadContext(env: SwEnv): Promise<Result<SwContext, UiError>> {
  const installation = await ensureInstallation(env.deps)
  const token = await readToken(env.deps, installation)
  const local = createLocalStore(env.deps)
  const localSnapshot = await local.read()
  if (!localSnapshot.ok) return localSnapshot
  return ok({
    installation,
    token,
    local,
    localSnapshot: localSnapshot.value,
    mode: localSnapshot.value.data.settings.mode,
    source: 'local',
    store: local,
  })
}
