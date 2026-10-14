import { err, ok, type Result } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { clearPairing, ensureInstallation, readToken, type Installation } from '../storage/installation'
import { createLocalStore } from '../storage/local-store'
import { createSharedStore, type SharedStore } from '../storage/shared-store'
import type { DataStore, Snapshot } from '../storage/data-store'
import type { SwDeps, SwEnv } from './deps'
import type { HostClient } from './host-client'
import { uiError } from './hints'
import type { Mode } from './mode'

// Todo lo que un manejador necesita saber de la instalación en el momento de atender un mensaje.
export interface SwContext {
  readonly installation: Installation
  readonly token: string | undefined
  readonly local: DataStore
  readonly localSnapshot: Snapshot
  readonly mode: Mode // localSnapshot.data.settings.mode (DC1)
  readonly source: 'local' | 'shared' // 'shared' solo con modo multi, token y cliente del host
  readonly shared: SharedStore | undefined // definido si y solo si source === 'shared'
  readonly store: DataStore // shared ?? local
}

// Almacén compartido con su manejo de not_paired: borra el emparejamiento local de esa instalación. Crearlo no llama
// al host; solo lo hacen read, write y refresh.
export function createInstallationSharedStore(
  deps: SwDeps,
  host: HostClient,
  token: string,
  installation: Installation,
  local: DataStore,
): SharedStore {
  return createSharedStore({
    deps,
    host,
    token,
    local,
    onNotPaired: async () => {
      await clearPairing(deps, installation)
    },
  })
}

// Instantánea del almacén de la instalación. Con origen local es la que loadContext ya leyó; con origen compartido, la
// caché o una lectura del host. Solo vale antes de escribir: tras una escritura hay que volver a leer.
export function readStore(context: SwContext): Promise<Result<Snapshot, UiError>> {
  return context.shared === undefined ? Promise.resolve(ok(context.localSnapshot)) : context.shared.read()
}

// Crea la instalación si falta (ensureInstallation exige la cola: se llama dentro de env.queue.run) y lee el
// almacén local. Un error de lectura se devuelve tal cual.
export async function loadContext(env: SwEnv): Promise<Result<SwContext, UiError>> {
  const installation = await ensureInstallation(env.deps)
  const token = await readToken(env.deps, installation)
  const local = createLocalStore(env.deps)
  const localSnapshot = await local.read()
  if (!localSnapshot.ok) return localSnapshot
  const mode = localSnapshot.value.data.settings.mode
  const shared =
    mode === 'multi' && token !== undefined && env.host !== undefined
      ? createInstallationSharedStore(env.deps, env.host, token, installation, local)
      : undefined
  return ok({
    installation,
    token,
    local,
    localSnapshot: localSnapshot.value,
    mode,
    source: shared === undefined ? 'local' : 'shared',
    shared,
    store: shared ?? local,
  })
}

// Prólogo común de los manejadores: trabajo en la cola con el contexto ya cargado. Un error de carga se devuelve tal cual.
export function inContext<T>(
  env: SwEnv,
  job: (context: SwContext) => Result<T, UiError> | Promise<Result<T, UiError>>,
): Promise<Result<T, UiError>> {
  return env.queue.run(async () => {
    const context = await loadContext(env)
    return context.ok ? job(context.value) : context
  })
}

// Regla general: en "Perfil único" ningún manejador llama al host; sin cliente (navegador no reconocido) tampoco puede.
export function requireHost(mode: Mode, host: HostClient | undefined): Result<HostClient, UiError> {
  if (mode === 'single') return err(uiError('unavailable', 'single_mode'))
  if (host === undefined) return err(uiError('unavailable', 'unsupported_browser'))
  return ok(host)
}
