import {
  err,
  ok,
  planImport,
  rebindFromHints,
  type Bindings,
  type ProfileInfo,
  type Result,
} from '@account-launcher/core'
import type { UiError, UiRequest, UiResults } from '@account-launcher/protocol'
import { saveBackup } from '../../storage/backup'
import type { Snapshot } from '../../storage/data-store'
import { inContext, requireHost, type SwContext } from '../context'
import type { SwEnv } from '../deps'
import { uiError } from '../hints'
import { withMode } from '../mode'
import type { Handler } from './types'

type ImportRequest = Extract<UiRequest, { type: 'data.import' }>

// La copia de seguridad no se pudo guardar: se aborta antes de confirmar el cambio.
class BackupFailed extends Error {}

// Perfiles contra los que se revincula (T11). En "Perfil único", o sin host, no hay llamada. Un fallo del host no
// impide importar: sin perfiles, las pistas por nombre quedan sin resolver.
async function profilesToRebind(context: SwContext, env: SwEnv): Promise<readonly ProfileInfo[]> {
  const host = requireHost(context.mode, env.host)
  if (!host.ok) return []
  const listed = await host.value.call('listProfiles', {})
  return listed.ok ? listed.value.profiles : []
}

// Vínculos de las identidades presentes; se reconstruye la tabla con entradas propias, sin indexar con ids recibidos.
function keepPresent(bindings: Bindings, present: ReadonlySet<string>): Bindings {
  return Object.fromEntries(Object.entries(bindings).filter(([identityId]) => present.has(identityId)))
}

// Cambio puro (el almacén compartido puede reaplicarlo tras un conflict): planImport, modo de la instalación y vínculos.
function importChange(request: ImportRequest, profiles: readonly ProfileInfo[]) {
  return (current: Snapshot): Result<{ next: Snapshot; value: UiResults['data.import'] }, UiError> => {
    const plan = planImport(current.data, request.data, request.mode)
    if (!plan.ok) return err(uiError('invalid', 'import_invalid'))
    // DC7: el modo es de la instalación; con replace, el resto de ajustes viene del archivo.
    const data = withMode(plan.value.data, current.data.settings.mode)

    const present = new Set(data.identities.map((identity) => identity.id))
    const replacing = request.mode === 'replace'
    // Con merge, las pistas solo valen para identidades sin vínculo propio; con replace, para todas. Las de
    // identidades que no están en los datos finales se ignoran.
    const hints = (request.bindingHints ?? []).filter(
      (hint) => present.has(hint.identityId) && (replacing || !Object.hasOwn(current.bindings, hint.identityId)),
    )
    const base = replacing ? keepPresent(current.bindings, present) : current.bindings
    const rebound = rebindFromHints(hints, profiles, base)

    const { added, updated, unchanged, removed } = plan.value
    return ok({
      next: { data, bindings: keepPresent(rebound.bindings, present) },
      value: { revision: data.revision, added, updated, unchanged, removed, unresolved: rebound.unresolved },
    })
  }
}

// request.revision se ignora (DC3): la importación se reaplica sobre el último estado. Antes de confirmar se guarda
// una copia de lo que se va a reemplazar; si no se puede guardar, no se importa nada.
export const importData: Handler<'data.import'> = (request, env) =>
  inContext(env, async (context) => {
    const profiles = await profilesToRebind(context, env)
    try {
      const written = await context.store.write(importChange(request, profiles), {
        beforeCommit: async (current) => {
          try {
            await saveBackup(env.deps, current, context.source)
          } catch {
            throw new BackupFailed()
          }
        },
      })
      return written.ok ? ok(written.value.value) : written
    } catch (error) {
      if (error instanceof BackupFailed) return err(uiError('internal', 'storage_write'))
      throw error
    }
  })
