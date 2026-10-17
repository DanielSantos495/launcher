import {
  BindingsSchema,
  err,
  loadData,
  ok,
  RevisionSchema,
  TimestampSchema,
  type Bindings,
  type LauncherData,
  type Result,
} from '@account-launcher/core'
import {
  IconImageSchema,
  MAX_SHARED_BINDINGS_BYTES,
  MAX_SHARED_DATA_BYTES,
  type UiError,
} from '@account-launcher/protocol'
import * as v from 'valibot'
import type { SwDeps } from '../background/deps'
import { uiError } from '../background/hints'
import { toUiError, type HostCallError, type HostClient } from '../background/host-client'
import type { DataStore, Snapshot, WriteOutcome } from './data-store'
import { SESSION_KEYS } from './keys'
import { imageKeys, removeLocalImages } from './icon-index'
import { jsonBytes } from './usage'

// Intentos de una escritura cuando otra instalación se adelanta (conflict): la primera base sale de la caché y las
// siguientes de una lectura nueva.
const MAX_WRITE_ATTEMPTS = 3

export interface SharedCache {
  readonly hostRevision: number
  readonly data: LauncherData
  readonly bindings: Bindings
  readonly fetchedAt: string
}

export interface SharedStore extends DataStore {
  readonly source: 'shared'
  // Lee del host (sync.get) y deja la caché al día. Es lo único, junto con write, que llama al host.
  refresh(): Promise<Result<SharedCache, UiError>>
}

// Forma de la caché en storage.session (DC4). `data` se valida aparte con loadData.
const CacheSchema = v.strictObject({
  hostRevision: RevisionSchema,
  data: v.unknown(),
  bindings: BindingsSchema,
  fetchedAt: TimestampSchema,
})

// Almacén de los datos compartidos, que viven en el host (ADR-003). Concurrencia optimista: cada escritura lleva la
// revisión del host que leyó y, si otra instalación escribió antes, se reaplica el cambio sobre lo último.
// Nada de lo que devuelve el host se usa sin validar, y los errores solo llevan código y pista.
export function createSharedStore(env: {
  readonly deps: SwDeps
  readonly host: HostClient
  readonly token: string
  readonly local: DataStore // para sembrar un almacén vacío
  readonly onNotPaired: () => Promise<void> // borra el emparejamiento local (clearPairing)
}): SharedStore {
  const { deps, host, token, local, onNotPaired } = env

  // Caché válida o undefined: si algo no valida, se trata como ausente y se vuelve a pedir al host.
  async function readCache(): Promise<SharedCache | undefined> {
    const stored = v.safeParse(CacheSchema, await deps.session.get(SESSION_KEYS.shared))
    if (!stored.success) return undefined
    const data = loadData(stored.output.data)
    if (!data.ok) return undefined
    const { hostRevision, bindings, fetchedAt } = stored.output
    return { hostRevision, data: data.value, bindings, fetchedAt }
  }

  // La caché es una optimización: si la sesión no deja escribirla, la operación sigue y la próxima lectura irá al host.
  // Se borra la anterior: dejarla serviría una revisión vieja como si fuera la actual.
  async function writeCache(cache: SharedCache): Promise<void> {
    try {
      await deps.session.set({ [SESSION_KEYS.shared]: cache })
    } catch {
      try {
        await deps.session.remove([SESSION_KEYS.shared])
      } catch {
        return
      }
    }
  }

  function cacheOf(hostRevision: number, snapshot: Snapshot): SharedCache {
    return { hostRevision, data: snapshot.data, bindings: snapshot.bindings, fetchedAt: deps.now().toISOString() }
  }

  // not_paired del host: otra instalación nos revocó (T15). Se borra el emparejamiento local.
  async function failed(error: HostCallError): Promise<Result<never, UiError>> {
    if (error.code === 'not_paired') await onNotPaired()
    return err(toUiError(error))
  }

  // Tras sembrar, las imágenes locales que los datos referencian se copian al host (icons.put), una a una y de mejor
  // esfuerzo: un fallo no deshace la siembra y deja esa imagen en local; limit_reached (o not_paired) detiene la copia.
  // Solo las copiadas se borran de storage.local. Va en la cola del llamante, igual que la siembra.
  async function migrateImages(data: LauncherData): Promise<void> {
    const copied: string[] = []
    try {
      for (const key of imageKeys(data)) {
        const image = v.safeParse(IconImageSchema, await deps.local.get(key))
        if (!image.success) continue
        const put = await host.call('icons.put', { token, key, mime: image.output.mime, base64: image.output.base64 })
        if (put.ok) {
          copied.push(key)
          continue
        }
        if (put.error.code === 'not_paired') await onNotPaired()
        if (put.error.code === 'limit_reached' || put.error.code === 'not_paired') break
      }
      await removeLocalImages(deps, data, copied)
    } catch {
      // Mejor esfuerzo: lo que no se pudo borrar solo ocupa sitio en local.
    }
  }

  // El almacén recién creado no tiene datos: se siembra con los locales. Si otra instalación sembró antes (conflict)
  // se vuelve a leer una sola vez.
  async function seed(baseRevision: number, mayRetry: boolean): Promise<Result<SharedCache, UiError>> {
    const snapshot = await local.read()
    if (!snapshot.ok) return snapshot
    const put = await host.call('sync.put', {
      token,
      baseRevision,
      data: snapshot.value.data,
      bindings: snapshot.value.bindings,
    })
    if (put.ok) {
      const cache = cacheOf(put.value.revision, snapshot.value)
      await writeCache(cache)
      await migrateImages(snapshot.value.data)
      return ok(cache)
    }
    if (put.error.code === 'conflict') return mayRetry ? fetchFromHost(false) : err(uiError('conflict'))
    if (put.error.code === 'too_large') return err(uiError('too_large', 'shared_data_full'))
    return failed(put.error)
  }

  async function fetchFromHost(mayRetrySeed: boolean): Promise<Result<SharedCache, UiError>> {
    const got = await host.call('sync.get', { token })
    if (!got.ok) return failed(got.error)
    const { revision, data, bindings } = got.value
    if (data === null) return seed(revision, mayRetrySeed)

    // Datos de otra versión o dañados: error claro y no se escribe nada en el host.
    const loaded = loadData(data)
    if (!loaded.ok) {
      return err(
        uiError('invalid', loaded.error.code === 'unsupported_version' ? 'shared_data_newer' : 'shared_data_invalid'),
      )
    }
    const checkedBindings = v.safeParse(BindingsSchema, bindings)
    if (!checkedBindings.success) return err(uiError('invalid', 'shared_bindings_invalid'))

    const cache = cacheOf(revision, { data: loaded.value, bindings: checkedBindings.output })
    // La caché solo se reescribe si cambia la revisión del host: con la misma, los datos son los mismos.
    const cached = await readCache()
    if (cached === undefined || cached.hostRevision !== revision) await writeCache(cache)
    return ok(cache)
  }

  async function cachedOrFetched(): Promise<Result<SharedCache, UiError>> {
    const cached = await readCache()
    return cached === undefined ? fetchFromHost(true) : ok(cached)
  }

  async function read(): Promise<Result<Snapshot, UiError>> {
    const cache = await cachedOrFetched()
    return cache.ok ? ok({ data: cache.value.data, bindings: cache.value.bindings }) : cache
  }

  async function write<T>(
    change: (current: Snapshot) => Result<{ next: Snapshot; value: T }, UiError>,
    options?: { beforeCommit?: (current: Snapshot) => Promise<void> },
  ): Promise<Result<WriteOutcome<T>, UiError>> {
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      const base = attempt === 1 ? await cachedOrFetched() : await fetchFromHost(true)
      if (!base.ok) return base
      const current: Snapshot = { data: base.value.data, bindings: base.value.bindings }

      const changed = change(current)
      if (!changed.ok) return changed
      const { next, value } = changed.value

      // Los límites del host se comprueban antes de enviar nada (ADR-004).
      if (jsonBytes(next.data) > MAX_SHARED_DATA_BYTES) return err(uiError('too_large', 'shared_data_full'))
      if (jsonBytes(next.bindings) > MAX_SHARED_BINDINGS_BYTES) return err(uiError('too_large', 'shared_bindings_full'))

      await options?.beforeCommit?.(current)
      const put = await host.call('sync.put', {
        token,
        baseRevision: base.value.hostRevision,
        data: next.data,
        bindings: next.bindings,
      })
      if (put.ok) {
        await writeCache(cacheOf(put.value.revision, next))
        return ok({ snapshot: next, value })
      }
      if (put.error.code === 'conflict') continue
      if (put.error.code === 'too_large') return err(uiError('too_large', 'shared_data_full'))
      return failed(put.error)
    }
    return err(uiError('conflict'))
  }

  return { source: 'shared', read, write, refresh: () => fetchFromHost(true) }
}
