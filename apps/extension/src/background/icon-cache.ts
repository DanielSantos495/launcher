import { IconImageSchema, type IconImage } from '@account-launcher/protocol'
import * as v from 'valibot'
import { SESSION_KEYS } from '../storage/keys'
import type { KeyValueArea } from './deps'

// Caché en storage.session de las imágenes leídas del host (icons.get). Cada clave tiene su propia entrada
// (iconCache:<clave>) para no leer ni reescribir todo al pedir una imagen; el índice (iconCache) solo sirve para
// descartarlas todas. Una entrada lleva el ámbito (huella del token) con el que se leyó y solo vale con el mismo.
// `null` es "no existe" y es definitivo mientras dure la sesión. Es solo una optimización: cualquier fallo de la sesión
// se trata como ausencia y la lectura va al host.
export interface IconCache {
  // undefined: no está en la caché; null: el host dijo que no existe.
  get(scope: string, key: string): Promise<IconImage | null | undefined>
  set(scope: string, key: string, image: IconImage | null): Promise<void>
  forget(key: string): Promise<void>
  clear(): Promise<void>
}

const entryKey = (key: string): string => `${SESSION_KEYS.iconCache}:${key}`

const EntrySchema = v.strictObject({ scope: v.string(), image: v.nullable(IconImageSchema) })
const IndexSchema = v.strictObject({ scope: v.string(), keys: v.array(v.string()) })

// Huella del token para el ámbito: la sesión no debe guardar el token tal cual.
export async function scopeOf(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createIconCache(session: KeyValueArea): IconCache {
  // Los cambios del índice se encadenan para que dos lecturas a la vez no pierdan entradas.
  let tail: Promise<unknown> = Promise.resolve()
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job)
    tail = result.catch(() => undefined)
    return result
  }

  async function readIndex(): Promise<v.InferOutput<typeof IndexSchema> | undefined> {
    const parsed = v.safeParse(IndexSchema, await session.get(SESSION_KEYS.iconCache))
    return parsed.success ? parsed.output : undefined
  }

  async function dropAll(): Promise<void> {
    const index = await readIndex()
    await session.remove([SESSION_KEYS.iconCache, ...(index?.keys ?? []).map(entryKey)])
  }

  return {
    async get(scope, key) {
      try {
        const entry = v.safeParse(EntrySchema, await session.get(entryKey(key)))
        return entry.success && entry.output.scope === scope ? entry.output.image : undefined
      } catch {
        return undefined
      }
    },
    set(scope, key, image) {
      return serial(async () => {
        try {
          const index = await readIndex()
          // Otro ámbito (otro token): se descarta lo anterior antes de guardar nada.
          if (index !== undefined && index.scope !== scope) await dropAll()
          const keys = index?.scope === scope ? index.keys : []
          await session.set({
            [entryKey(key)]: { scope, image },
            [SESSION_KEYS.iconCache]: { scope, keys: keys.includes(key) ? keys : [...keys, key] },
          })
        } catch {
          // Sin sitio en la sesión (o sin sesión): no se cachea.
        }
      })
    },
    forget(key) {
      return serial(async () => {
        try {
          await session.remove([entryKey(key)])
        } catch {
          // Solo una caché.
        }
      })
    },
    clear() {
      return serial(async () => {
        try {
          await dropAll()
        } catch {
          // Solo una caché.
        }
      })
    },
  }
}

const caches = new WeakMap<KeyValueArea, IconCache>()

// Una sola caché por área de sesión, para que compartan la cadena de cambios.
export function iconCacheOf(session: KeyValueArea): IconCache {
  const existing = caches.get(session)
  if (existing !== undefined) return existing
  const created = createIconCache(session)
  caches.set(session, created)
  return created
}
