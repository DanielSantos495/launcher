import { applyOps, err, ok, type OpError } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { loadContext } from '../context'
import { uiError } from '../hints'
import { withMode } from '../mode'
import type { Handler } from '../router'

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
  env.queue.run(async () => {
    const context = await loadContext(env)
    if (!context.ok) return context
    const snapshot = await context.value.store.read()
    if (!snapshot.ok) return snapshot
    return ok({ data: withMode(snapshot.value.data, context.value.mode), source: context.value.source })
  })

// request.revision se ignora (DC3): las operaciones se reaplican sobre el último estado.
export const mutateData: Handler<'data.mutate'> = (request, env) =>
  env.queue.run(async () => {
    const context = await loadContext(env)
    if (!context.ok) return context
    const written = await context.value.store.write((current) => {
      const applied = applyOps(current.data, request.ops)
      if (!applied.ok) return err(opError(applied.error))
      return ok({
        next: { data: applied.value, bindings: current.bindings },
        value: { revision: applied.value.revision },
      })
    })
    return written.ok ? ok(written.value.value) : written
  })

export const getBindings: Handler<'bindings.get'> = (_request, env) =>
  env.queue.run(async () => {
    const context = await loadContext(env)
    if (!context.ok) return context
    const snapshot = await context.value.store.read()
    if (!snapshot.ok) return snapshot
    return ok({ bindings: snapshot.value.bindings })
  })

export const setBinding: Handler<'bindings.set'> = (request, env) =>
  env.queue.run(async () => {
    const context = await loadContext(env)
    if (!context.ok) return context
    const written = await context.value.store.write((current) => {
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
