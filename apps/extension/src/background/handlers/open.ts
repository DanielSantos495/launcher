import { applyOps, buildAccountUrl, err, ok, resolveTarget, type OpenTarget, type Result } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { createProviders } from '../../providers/providers'
import { loadContext } from '../context'
import { uiError } from '../hints'
import { withMode } from '../mode'
import type { Handler } from '../router'

interface OpenPlan {
  readonly accountId: string
  readonly url: string
  readonly target: OpenTarget
}

export const openAccount: Handler<'account.open'> = async (request, env) => {
  // Primero se decide, dentro de la cola, qué URL y qué destino corresponden.
  const planned = await env.queue.run(async (): Promise<Result<OpenPlan, UiError>> => {
    const context = await loadContext(env)
    if (!context.ok) return context
    const snapshot = await context.value.store.read()
    if (!snapshot.ok) return snapshot
    const data = withMode(snapshot.value.data, context.value.mode)
    const account = data.accounts.find((candidate) => candidate.id === request.accountId)
    if (account === undefined) return err(uiError('not_found'))
    if (request.asIdentityId !== undefined && !data.identities.some((i) => i.id === request.asIdentityId)) {
      return err(uiError('not_found'))
    }
    const url = buildAccountUrl(data, account)
    if (!url.ok) return err(uiError('invalid', `url_${url.error}`))
    const target = resolveTarget({ data, bindings: snapshot.value.bindings }, account, request.asIdentityId)
    return ok({ accountId: account.id, url: url.value, target })
  })
  if (!planned.ok) return planned
  // El destino chromium-profile necesita el host (Tarea 4).
  if (planned.value.target.kind !== 'current') return err(uiError('unavailable', 'not_implemented'))

  const opened = await createProviders(env.deps).current.open(planned.value.url)
  if (!opened.ok) return opened

  // La apertura ya ocurrió: si el toque de lastOpenedAt falla, el resultado sigue siendo correcto.
  const at = env.deps.now().toISOString()
  await env.queue
    .run(async () => {
      const context = await loadContext(env)
      if (!context.ok) return
      await context.value.store.write((current) => {
        const applied = applyOps(current.data, [{ type: 'account.touch', id: planned.value.accountId, at }])
        if (!applied.ok) return err(uiError('not_found'))
        return ok({ next: { data: applied.value, bindings: current.bindings }, value: undefined })
      })
    })
    .catch(() => undefined)
  return ok({ provider: 'current' })
}
