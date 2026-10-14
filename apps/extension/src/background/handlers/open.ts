import {
  applyOps,
  buildAccountUrl,
  err,
  normalizeUrl,
  ok,
  resolveTarget,
  type OpenTarget,
  type Result,
} from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { createProviders } from '../../providers/providers'
import { inContext, readStore, requireHost } from '../context'
import type { SwEnv } from '../deps'
import { uiError } from '../hints'
import { withMode } from '../mode'
import type { Handler } from './types'

interface OpenPlan {
  readonly accountId: string
  readonly url: string
  readonly target: OpenTarget
}

interface TemporaryPlan {
  readonly profileDirectory: string
  readonly url: string
  readonly accountId: string | undefined // solo con destino cuenta: es la que se marca como abierta
}

// La apertura ya ocurrió: si el toque de lastOpenedAt falla, el resultado sigue siendo correcto.
async function touchLastOpened(env: SwEnv, accountId: string): Promise<void> {
  const at = env.deps.now().toISOString()
  await inContext(env, (context) =>
    context.store.write((current) => {
      const applied = applyOps(current.data, [{ type: 'account.touch', id: accountId, at }])
      if (!applied.ok) return err(uiError('not_found'))
      return ok({ next: { data: applied.value, bindings: current.bindings }, value: undefined })
    }),
  ).catch(() => undefined)
}

export const openAccount: Handler<'account.open'> = async (request, env) => {
  // Primero se decide, dentro de la cola, qué URL y qué destino corresponden.
  const planned = await inContext(env, async (context): Promise<Result<OpenPlan, UiError>> => {
    const snapshot = await readStore(context)
    if (!snapshot.ok) return snapshot
    const data = withMode(snapshot.value.data, context.mode)
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

  // En "Perfil único" resolveTarget siempre da current: el host solo se usa con un vínculo en "Varios perfiles".
  const { target, url } = planned.value
  const providers = createProviders(env.deps, env.host)
  const opened =
    target.kind === 'current'
      ? await providers.current.open(url)
      : await providers.chromiumProfile.open(url, target.profileDirectory)
  if (!opened.ok) return opened

  await touchLastOpened(env, planned.value.accountId)
  return ok({ provider: target.kind })
}

export const openTemporary: Handler<'account.openTemporary'> = async (request, env) => {
  const planned = await inContext(env, async (context): Promise<Result<TemporaryPlan, UiError>> => {
    const host = requireHost(context.mode, env.host)
    if (!host.ok) return host
    const profileDirectory = context.installation.ownProfileDirectory
    if (profileDirectory === undefined) return err(uiError('unavailable', 'declare_profile'))
    const snapshot = await readStore(context)
    if (!snapshot.ok) return snapshot
    const data = withMode(snapshot.value.data, context.mode)
    const base = { profileDirectory }
    if (request.target.kind === 'url') {
      const url = normalizeUrl(request.target.url, { allowHttp: data.settings.allowHttp })
      if (!url.ok) return err(uiError('invalid', `url_${url.error}`))
      return ok({ ...base, url: url.value, accountId: undefined })
    }
    const { accountId } = request.target
    const account = data.accounts.find((candidate) => candidate.id === accountId)
    if (account === undefined) return err(uiError('not_found'))
    const url = buildAccountUrl(data, account)
    if (!url.ok) return err(uiError('invalid', `url_${url.error}`))
    return ok({ ...base, url: url.value, accountId: account.id })
  })
  if (!planned.ok) return planned

  const { profileDirectory, url, accountId } = planned.value
  const opened = await createProviders(env.deps, env.host).braveTemporaryContainer.open(
    url,
    profileDirectory,
    request.name,
  )
  if (!opened.ok) return opened

  if (accountId !== undefined) await touchLastOpened(env, accountId)
  return ok({})
}
