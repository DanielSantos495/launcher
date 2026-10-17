import { err, ok, type LauncherData, type Result } from '@account-launcher/core'
import { IconImageSchema, type UiError } from '@account-launcher/protocol'
import * as v from 'valibot'
import { inContext, type SwContext } from '../context'
import type { SwEnv } from '../deps'
import { uiError } from '../hints'
import type { HostCallError } from '../host-client'
import type { Handler } from './types'
import { settle } from './pairing'

// Imágenes subidas como icono (T5). Con datos locales viven en storage.local bajo su propia clave (icon:<id>); con la
// instalación emparejada, en el host (icons.*). Ninguna entra en la exportación: ver docs en ImportExport.

// Error del host con pista propia para los dos límites de imágenes (el texto general habla de perfiles o de datos).
function iconHostError(error: UiError): UiError {
  if (error.code === 'limit_reached') return uiError('limit_reached', 'icon_limit')
  if (error.code === 'too_large') return uiError('too_large', 'icon_too_large')
  return error
}

// Un comando de imagen al host con el token del emparejamiento; solo se llama con source === 'shared'.
function hostOf(env: SwEnv, context: SwContext) {
  const { host } = env
  const { token } = context
  return context.shared === undefined || host === undefined || token === undefined ? undefined : { host, token }
}

export const iconGet: Handler<'icon.get'> = (request, env) =>
  inContext(env, async (context) => {
    const remote = hostOf(env, context)
    if (remote === undefined) {
      // Lo guardado se vuelve a validar: storage.local no es de fiar si otra versión o un fallo escribió algo raro.
      const stored = v.safeParse(IconImageSchema, await env.deps.local.get(request.key))
      return stored.success ? ok(stored.output) : err(uiError('not_found'))
    }
    const got = await settle(
      env,
      context,
      await remote.host.call('icons.get', { token: remote.token, key: request.key }),
    )
    if (!got.ok) return err(iconHostError(got.error))
    const image = v.safeParse(IconImageSchema, { mime: got.value.mime, base64: got.value.base64 })
    return image.success ? ok(image.output) : err(uiError('host_error', 'bad_response'))
  })

export const iconPut: Handler<'icon.put'> = (request, env) =>
  inContext(env, async (context) => {
    const remote = hostOf(env, context)
    if (remote === undefined) {
      try {
        await env.deps.local.set({ [request.key]: { mime: request.mime, base64: request.base64 } })
      } catch {
        return err(uiError('internal', 'storage_write'))
      }
      return ok({})
    }
    const put = await settle(
      env,
      context,
      await remote.host.call('icons.put', {
        token: remote.token,
        key: request.key,
        mime: request.mime,
        base64: request.base64,
      }),
    )
    return put.ok ? ok({}) : err(iconHostError(put.error))
  })

export const iconDelete: Handler<'icon.delete'> = (request, env) =>
  inContext(env, async (context) => {
    const remote = hostOf(env, context)
    if (remote === undefined) {
      try {
        await env.deps.local.remove([request.key])
      } catch {
        return err(uiError('internal', 'storage_write'))
      }
      return ok({})
    }
    const deleted = await settle(
      env,
      context,
      await remote.host.call('icons.delete', { token: remote.token, key: request.key }),
    )
    return deleted.ok ? ok({}) : err(iconHostError(deleted.error))
  })

// Claves de imagen que usan los datos (avatar de identidad, icono de grupo y de cuenta).
export function imageKeys(data: LauncherData): Set<string> {
  const keys = new Set<string>()
  for (const icon of [
    ...data.identities.map((identity) => identity.avatar),
    ...data.groups.map((group) => group.icon),
    ...data.accounts.map((account) => account.icon),
  ]) {
    if (icon?.type === 'image') keys.add(icon.key)
  }
  return keys
}

// Borrado en cascada: tras guardar `after`, las imágenes que usaba `before` y ya nadie usa se borran (al borrar la
// cuenta o al cambiar su icono). Es de mejor esfuerzo y va dentro de la cola de escritura del llamante: si falla, la
// imagen huérfana solo ocupa sitio y el resultado de la operación principal no cambia.
export async function releaseImages(
  env: SwEnv,
  context: SwContext,
  before: LauncherData,
  after: LauncherData,
): Promise<void> {
  const kept = imageKeys(after)
  const orphans = [...imageKeys(before)].filter((key) => !kept.has(key))
  if (orphans.length === 0) return
  const remote = hostOf(env, context)
  if (remote === undefined) {
    try {
      await env.deps.local.remove(orphans)
    } catch {
      // Mejor esfuerzo.
    }
    return
  }
  for (const key of orphans) {
    const deleted: Result<unknown, HostCallError> = await remote.host.call('icons.delete', { token: remote.token, key })
    if (!deleted.ok && deleted.error.code === 'not_paired') {
      await settle(env, context, deleted)
      return
    }
  }
}
