import { err, ok, type LauncherData, type Result } from '@account-launcher/core'
import { IconImageSchema, type UiError } from '@account-launcher/protocol'
import * as v from 'valibot'
import { imageKeys, LOCAL_ICON_LIMIT, readIconIndex, removeLocalImages } from '../../storage/icon-index'
import { clearPairing, InstallationSchema, readToken } from '../../storage/installation'
import { LOCAL_KEYS } from '../../storage/keys'
import { inContext, type SwContext } from '../context'
import type { SwEnv } from '../deps'
import { uiError } from '../hints'
import { iconCacheOf, scopeOf } from '../icon-cache'
import { createLimiter, type Limiter } from '../limiter'
import { toUiError, type HostCallError, type HostClient } from '../host-client'
import type { Handler } from './types'
import { settle } from './pairing'

// Lecturas de imagen al host a la vez: con una lista larga la interfaz pide muchas y no deben ir en serie ni todas juntas.
const MAX_CONCURRENT_READS = 4

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

// Destino de una lectura sin pasar por la cola: leer no escribe, así que no espera a las escrituras. Solo lee
// (nunca crea la instalación) y es compartido con instalación emparejada, modo Varios perfiles, token y cliente.
async function readTarget(env: SwEnv): Promise<{ host: HostClient; token: string } | undefined> {
  const { host, deps } = env
  const installation = v.safeParse(InstallationSchema, await deps.local.get(LOCAL_KEYS.installation))
  if (host === undefined || !installation.success) return undefined
  const token = await readToken(deps, installation.output)
  const stored = v.safeParse(
    v.object({ settings: v.object({ mode: v.literal('multi') }) }),
    await deps.local.get(LOCAL_KEYS.localData),
  )
  return token === undefined || !stored.success ? undefined : { host, token }
}

const limiters = new WeakMap<SwEnv, Limiter>()

function readLimiter(env: SwEnv): Limiter {
  const existing = limiters.get(env)
  if (existing !== undefined) return existing
  const created = createLimiter(MAX_CONCURRENT_READS)
  limiters.set(env, created)
  return created
}

// not_paired fuera de la cola: el borrado del emparejamiento sí entra en ella, y solo si el token sigue siendo el que falló.
function revoke(env: SwEnv, token: string): Promise<void> {
  return env.queue.run(async () => {
    const installation = v.safeParse(InstallationSchema, await env.deps.local.get(LOCAL_KEYS.installation))
    if (installation.success && (await readToken(env.deps, installation.output)) === token) {
      await clearPairing(env.deps, installation.output)
    }
  })
}

// icon.get no pasa por la cola de escritura. Con datos locales lee storage.local (y descarta la caché de las del
// host); emparejado, sirve de la caché de sesión y, si falta, pide al host con un máximo de 4 lecturas a la vez.
export const iconGet: Handler<'icon.get'> = async (request, env) => {
  const cache = iconCacheOf(env.deps.session)
  const target = await readTarget(env)
  if (target === undefined) {
    await cache.clear()
    // Lo guardado se vuelve a validar: storage.local no es de fiar si otra versión o un fallo escribió algo raro.
    const stored = v.safeParse(IconImageSchema, await env.deps.local.get(request.key))
    return stored.success ? ok(stored.output) : err(uiError('not_found'))
  }
  const scope = await scopeOf(target.token)
  const cached = await cache.get(scope, request.key)
  if (cached === null) return err(uiError('not_found'))
  if (cached !== undefined) return ok(cached)
  const got = await readLimiter(env).run(() => target.host.call('icons.get', { token: target.token, key: request.key }))
  if (!got.ok) {
    if (got.error.code === 'not_paired') await revoke(env, target.token)
    // Que no exista (o que el host rechace la clave) es definitivo en la sesión; un fallo pasajero no.
    if (got.error.code === 'not_found' || got.error.code === 'invalid') await cache.set(scope, request.key, null)
    return err(iconHostError(toUiError(got.error)))
  }
  const image = v.safeParse(IconImageSchema, { mime: got.value.mime, base64: got.value.base64 })
  if (!image.success) return err(uiError('host_error', 'bad_response'))
  await cache.set(scope, request.key, image.output)
  return ok(image.output)
}

export const iconPut: Handler<'icon.put'> = (request, env) =>
  inContext(env, async (context) => {
    const remote = hostOf(env, context)
    if (remote === undefined) {
      // Tope local: una clave nueva por encima de 100 no cabe; reemplazar una que existe no suma.
      const index = await readIconIndex(env.deps, context.localSnapshot.data)
      const known = index.includes(request.key)
      if (!known && index.length >= LOCAL_ICON_LIMIT) return err(uiError('limit_reached', 'icon_limit'))
      try {
        // Imagen e índice en la misma escritura: nunca queda una sin la otra.
        await env.deps.local.set({
          [request.key]: { mime: request.mime, base64: request.base64 },
          [LOCAL_KEYS.iconIndex]: known ? index : [...index, request.key],
        })
      } catch {
        return err(uiError('internal', 'storage_write'))
      }
      return ok({})
    }
    await iconCacheOf(env.deps.session).forget(request.key)
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
        await removeLocalImages(env.deps, context.localSnapshot.data, [request.key])
      } catch {
        return err(uiError('internal', 'storage_write'))
      }
      return ok({})
    }
    await iconCacheOf(env.deps.session).forget(request.key)
    const deleted = await settle(
      env,
      context,
      await remote.host.call('icons.delete', { token: remote.token, key: request.key }),
    )
    return deleted.ok ? ok({}) : err(iconHostError(deleted.error))
  })

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
      await removeLocalImages(env.deps, before, orphans)
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
