import { err, ok } from '@account-launcher/core'
import { inContext, readStore, requireHost } from '../context'
import { uiError } from '../hints'
import { setBinding } from './data'
import type { Handler } from './types'

// Tras crear un perfil, Brave tarda en escribirlo en Local State: se consulta hasta 20 veces, cada 500 ms (DC9).
const LIST_ATTEMPTS = 20
const LIST_INTERVAL_MS = 500

export const profilesList: Handler<'profiles.list'> = async (_request, env) => {
  const host = await inContext(env, (context) => requireHost(context.mode, env.host))
  if (!host.ok) return host
  const listed = await host.value.call('listProfiles', {})
  return listed.ok ? ok({ profiles: listed.value.profiles }) : listed
}

export const profilesCreate: Handler<'profiles.create'> = async (request, env) => {
  // Antes de tocar el host: modo, cliente e identidad. Una identidad inexistente no crea ningún perfil.
  const planned = await inContext(env, async (context) => {
    const host = requireHost(context.mode, env.host)
    if (!host.ok) return host
    const snapshot = await readStore(context)
    if (!snapshot.ok) return snapshot
    if (!snapshot.value.data.identities.some((identity) => identity.id === request.identityId)) {
      return err(uiError('not_found'))
    }
    return host
  })
  if (!planned.ok) return planned
  const host = planned.value

  const created = await host.call('createProfile', {})
  if (!created.ok) return created
  const { directory } = created.value

  for (let attempt = 0; attempt < LIST_ATTEMPTS; attempt++) {
    await env.deps.sleep(LIST_INTERVAL_MS)
    const listed = await host.call('listProfiles', {})
    if (!listed.ok) return listed
    if (!listed.value.profiles.some((profile) => profile.directory === directory)) continue
    // El vínculo se escribe solo cuando la carpeta ya aparece; setBinding vuelve a comprobar la identidad en la cola.
    const bound = await setBinding(
      {
        type: 'bindings.set',
        identityId: request.identityId,
        binding: { kind: 'chromium-profile', profileDirectory: directory, desiredName: request.name },
      },
      env,
    )
    return bound.ok ? ok({ directory }) : bound
  }
  return err(uiError('host_error', 'profile_not_listed'))
}
