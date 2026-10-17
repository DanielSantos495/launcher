import { err, ok, type Result } from '@account-launcher/core'
import type { UiError } from '@account-launcher/protocol'
import { clearPairing, saveInstallation, savePairing, type Installation } from '../../storage/installation'
import { createInstallationSharedStore, inContext, readStore, requireHost, type SwContext } from '../context'
import type { SwEnv } from '../deps'
import { uiError } from '../hints'
import { toUiError, type HostCallError, type HostClient } from '../host-client'
import type { WhoamiProve, WhoamiResult } from '../internal-messages'
import type { Handler } from './types'

// Prólogo de los mensajes pair.*: en la cola, con el modo y el cliente del host ya comprobados (en "Perfil único" el
// host no se llama nunca).
function withHost<T>(
  env: SwEnv,
  job: (context: SwContext, host: HostClient) => Promise<Result<T, UiError>>,
): Promise<Result<T, UiError>> {
  return inContext(env, (context) => {
    const host = requireHost(context.mode, env.host)
    return host.ok ? job(context, host.value) : host
  })
}

// Resultado de un comando del host enviado con token. not_paired significa que otra instalación nos revocó (T15):
// se borra el emparejamiento local. La UI recibe solo código y pista, nunca la revisión de un conflict.
export async function settle<T>(
  env: SwEnv,
  context: SwContext,
  result: Result<T, HostCallError>,
): Promise<Result<T, UiError>> {
  if (result.ok) return result
  if (result.error.code === 'not_paired') await clearPairing(env.deps, context.installation)
  return err(toUiError(result.error))
}

// Guarda el token (y la instalación como emparejada, en una sola escritura), hace la primera lectura del almacén
// compartido, que lo siembra con los datos locales si está recién creado, y declara en el host el perfil que esta
// instalación anunció antes de emparejarse (el host no lo conoce hasta tener el token). Un fallo de la lectura o de la
// declaración no deshace el emparejamiento: el siguiente data.get o sync.refresh lo muestra y el perfil se puede
// declarar de nuevo en "Este perfil es…".
async function enroll(env: SwEnv, context: SwContext, host: HostClient, token: string): Promise<void> {
  const paired = await savePairing(env.deps, context.installation, token)
  const shared = await createInstallationSharedStore(env.deps, host, token, paired, context.local).refresh()
  const { installationId, ownProfileDirectory: profileDirectory, ownIdentityId } = paired
  if (profileDirectory === undefined) return
  // La identidad se eligió entre los datos locales: solo vale si también está en la lista compartida, que puede ser de
  // otro perfil. Si esa lista no se puede leer tampoco se puede saber, y se trata como ausente.
  const identityId =
    shared.ok && shared.value.data.identities.some((identity) => identity.id === ownIdentityId)
      ? ownIdentityId
      : undefined
  const declared = await settle(
    env,
    context,
    await host.call('pair.declare', {
      token,
      profileDirectory,
      ...(identityId === undefined ? {} : { identityId }),
    }),
  )
  // Con not_paired settle ya borró el emparejamiento: no se vuelve a guardar la instalación como emparejada.
  const revoked = !declared.ok && declared.error.code === 'not_paired'
  if (ownIdentityId !== undefined && identityId === undefined && !revoked) {
    await saveInstallation(env.deps, { installationId, paired: true, ownProfileDirectory: profileDirectory })
  }
}

export const pairStart: Handler<'pair.start'> = (_request, env) =>
  withHost(env, async (context, host) => {
    const { installationId } = context.installation
    if (context.token !== undefined) {
      const started = await settle(
        env,
        context,
        await host.call('pair.start', { installationId, token: context.token }),
      )
      return started.ok ? ok({ code: started.value.code, expiresAt: started.value.expiresAt }) : started
    }
    // Primer emparejamiento (DC13): sin token el host crea el almacén y devuelve el token de esta instalación.
    const started = await host.call('pair.start', { installationId })
    if (!started.ok) return err(toUiError(started.error))
    const { code, expiresAt, token } = started.value
    if (token === undefined) return err(uiError('host_error', 'bad_response'))
    await enroll(env, context, host, token)
    return ok({ code, expiresAt })
  })

export const pairJoin: Handler<'pair.join'> = (request, env) =>
  withHost(env, async (context, host) => {
    if (context.token !== undefined) return err(uiError('invalid', 'already_paired'))
    const joined = await host.call('pair.join', {
      installationId: context.installation.installationId,
      code: request.code,
    })
    if (!joined.ok) return err(toUiError(joined.error))
    await enroll(env, context, host, joined.value.token)
    return ok({})
  })

export const pairDeclare: Handler<'pair.declare'> = (request, env) =>
  withHost(env, async (context, host) => {
    const { profileDirectory, identityId } = request
    if (identityId !== undefined) {
      const snapshot = await readStore(context)
      if (!snapshot.ok) return snapshot
      if (!snapshot.value.data.identities.some((identity) => identity.id === identityId)) {
        return err(uiError('not_found'))
      }
    }
    if (context.token !== undefined) {
      const declared = await settle(
        env,
        context,
        await host.call('pair.declare', {
          token: context.token,
          profileDirectory,
          ...(identityId === undefined ? {} : { identityId }),
        }),
      )
      if (!declared.ok) return declared
    }
    // Sin identityId se quita la que hubiera: la instalación la declara de nuevo cada vez.
    const { installationId, paired } = context.installation
    const declared: Installation = {
      installationId,
      paired,
      ownProfileDirectory: profileDirectory,
      ...(identityId === undefined ? {} : { ownIdentityId: identityId }),
    }
    await saveInstallation(env.deps, declared)
    return ok({})
  })

export const pairList: Handler<'pair.list'> = (_request, env) =>
  withHost(env, async (context, host) => {
    if (context.token === undefined) return err(uiError('not_paired'))
    return settle(env, context, await host.call('pair.list', { token: context.token }))
  })

export const pairRemove: Handler<'pair.remove'> = (request, env) =>
  withHost(env, async (context, host) => {
    if (context.token === undefined) return err(uiError('not_paired'))
    const removed = await settle(
      env,
      context,
      await host.call('pair.remove', { token: context.token, installationId: request.installationId }),
    )
    if (!removed.ok) return removed
    if (request.installationId === context.installation.installationId)
      await clearPairing(env.deps, context.installation)
    return ok({})
  })

export const pairVerify: Handler<'pair.verify'> = (_request, env) =>
  withHost(env, async (context, host) => {
    if (context.token === undefined) return err(uiError('not_paired'))
    if (context.installation.ownProfileDirectory === undefined) return err(uiError('unavailable', 'declare_profile'))
    const verified = await settle(env, context, await host.call('pair.verify', { token: context.token }))
    return verified.ok ? ok({ expiresAt: verified.value.expiresAt }) : verified
  })

// Mensaje interno de la página whoami (DC6): reenvía al host el nonce que este perfil recibió en la URL. El host
// comprueba que ese nonce se emitió para esta instalación; si no es así, bad_nonce.
export function whoamiProve(request: WhoamiProve, env: SwEnv): Promise<Result<WhoamiResult, UiError>> {
  return inContext(env, async (context) => {
    // Sin token no hay nada que probar; con él, "Perfil único" sigue sin llamar al host.
    if (context.token === undefined) return err(uiError('not_paired'))
    const host = requireHost(context.mode, env.host)
    if (!host.ok) return host
    const proved = await settle(
      env,
      context,
      await host.value.call('pair.prove', { token: context.token, nonce: request.nonce }),
    )
    return proved.ok ? ok({ verifiedAt: proved.value.verifiedAt }) : proved
  })
}

// Con origen local no hay nada que sincronizar (y el host no se llama); con origen compartido se vuelve a leer del host.
export const syncRefresh: Handler<'sync.refresh'> = (_request, env) =>
  inContext(env, async (context) => {
    if (context.shared === undefined) return ok({ revision: context.localSnapshot.data.revision })
    const refreshed = await context.shared.refresh()
    return refreshed.ok ? ok({ revision: refreshed.value.hostRevision }) : refreshed
  })
