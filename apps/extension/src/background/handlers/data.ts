import { applyOps, err, ok, parseLauncherData, type Op, type OpError, type Result } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { saveBackup } from '../../storage/backup'
import type { Snapshot } from '../../storage/data-store'
import type { SharedStore } from '../../storage/shared-store'
import { inContext, readStore, type SwContext } from '../context'
import type { SwEnv } from '../deps'
import { uiError } from '../hints'
import { splitModeChange, withMode } from '../mode'
import type { Handler } from './types'

// Los errores de applyOps se traducen a código y pista: nunca llevan la lista de problemas del esquema.
function opError(error: OpError): UiError {
  switch (error.code) {
    case 'not_found':
      return uiError('not_found')
    case 'in_use':
      return uiError('invalid', 'in_use')
    case 'invalid':
      return uiError('invalid', 'op_invalid')
  }
}

export const getData: Handler<'data.get'> = (_request, env) =>
  inContext(env, async (context) => {
    const snapshot = await readStore(context)
    if (!snapshot.ok) return snapshot
    return ok({ data: withMode(snapshot.value.data, context.mode), source: context.source })
  })

// Cambio puro que aplica las operaciones sobre la base (el almacén compartido puede reaplicarlo tras un conflict).
function applyChange(ops: readonly Op[]) {
  return (current: Snapshot): Result<{ next: Snapshot; value: { revision: number } }, UiError> => {
    const applied = applyOps(current.data, ops)
    if (!applied.ok) return err(opError(applied.error))
    return ok({
      next: { data: applied.value, bindings: current.bindings },
      value: { revision: applied.value.revision },
    })
  }
}

// Vuelta a "Perfil único" estando emparejado (DC2): los datos compartidos (caché o sync.get) pasan a ser los locales,
// con el modo single, tras guardar una copia de los locales. Si no se pueden obtener, solo cambia el modo local.
async function switchToSingle(
  env: SwEnv,
  context: SwContext,
  shared: SharedStore,
): Promise<Result<{ revision: number }, UiError>> {
  const base = await shared.read()
  const written = base.ok
    ? await context.local.write(
        (current) => {
          const copied = parseLauncherData({
            ...base.value.data,
            settings: { ...base.value.data.settings, mode: 'single' },
            revision: current.data.revision + 1,
          })
          if (!copied.ok) return err(uiError('internal', 'shared_data_invalid'))
          return ok({
            next: { data: copied.value, bindings: base.value.bindings },
            value: { revision: copied.value.revision },
          })
        },
        { beforeCommit: (current) => saveBackup(env.deps, current, 'local') },
      )
    : await context.local.write(applyChange([{ type: 'settings.set', settings: { mode: 'single' } }]))
  return written.ok ? ok(written.value.value) : written
}

// Con la instalación emparejada, el modo es de esta instalación (DC1) y el resto de ajustes, de los dos perfiles (DC10).
async function mutateShared(
  env: SwEnv,
  context: SwContext,
  shared: SharedStore,
  ops: readonly Op[],
): Promise<Result<{ revision: number }, UiError>> {
  const { mode, rest } = splitModeChange(ops)
  let revision: number | undefined
  if (rest.length > 0) {
    const written = await shared.write(applyChange(rest))
    if (!written.ok) return written
    revision = written.value.value.revision
  }
  if (mode === 'single') {
    const switched = await switchToSingle(env, context, shared)
    if (!switched.ok) return switched
    revision = switched.value.revision
  }
  if (revision !== undefined) return ok({ revision })
  // Solo había un cambio a "Varios perfiles" que ya estaba activo: no se escribe nada.
  const snapshot = await shared.read()
  return snapshot.ok ? ok({ revision: snapshot.value.data.revision }) : snapshot
}

// request.revision se ignora (DC3): las operaciones se reaplican sobre el último estado.
export const mutateData: Handler<'data.mutate'> = (request, env) =>
  inContext(env, async (context) => {
    if (context.shared !== undefined) return mutateShared(env, context, context.shared, request.ops)
    const written = await context.store.write(applyChange(request.ops))
    return written.ok ? ok(written.value.value) : written
  })

export const getBindings: Handler<'bindings.get'> = (_request, env) =>
  inContext(env, async (context) => {
    const snapshot = await readStore(context)
    if (!snapshot.ok) return snapshot
    return ok({ bindings: snapshot.value.bindings })
  })

export const setBinding: Handler<'bindings.set'> = (request, env) =>
  inContext(env, async (context) => {
    const written = await context.store.write((current) => {
      if (!current.data.identities.some((identity) => identity.id === request.identityId)) {
        return err(uiError('not_found'))
      }
      // Se reconstruye la tabla con entradas propias: nunca se indexa un objeto con un id recibido.
      const entries = Object.entries(current.bindings).filter(([identityId]) => identityId !== request.identityId)
      if (request.binding !== null) entries.push([request.identityId, request.binding])
      return ok({ next: { data: current.data, bindings: Object.fromEntries(entries) }, value: {} })
    })
    return written.ok ? ok(written.value.value) : written
  })
