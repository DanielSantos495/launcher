import type { LauncherData } from '@account-launcher/core'
import { IconImageSchema, UploadedIconKeySchema } from '@account-launcher/protocol'
import * as v from 'valibot'
import type { SwDeps } from '../background/deps'
import { LOCAL_KEYS } from './keys'

// Tope de imágenes en storage.local (10 MiB de cuota): sin él, unas 230 imágenes de 43 KiB llenarían el área y harían
// fallar las escrituras de los datos y de la copia de seguridad. El host tiene el suyo (2500).
export const LOCAL_ICON_LIMIT = 100

const IndexSchema = v.pipe(
  v.array(UploadedIconKeySchema),
  v.check((keys) => new Set(keys).size === keys.length),
)

// Índice guardado, o undefined si falta o no valida.
export function parseIconIndex(raw: unknown): string[] | undefined {
  const parsed = v.safeParse(IndexSchema, raw)
  return parsed.success ? parsed.output : undefined
}

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

// Claves de imagen guardadas en storage.local. Si el índice falta o está dañado se reconstruye con las imágenes que
// los datos referencian y que existen: las huérfanas no se pueden enumerar sin leer toda el área. Va en la cola.
export async function readIconIndex(deps: SwDeps, data: LauncherData): Promise<string[]> {
  const stored = parseIconIndex(await deps.local.get(LOCAL_KEYS.iconIndex))
  if (stored !== undefined) return stored
  const rebuilt: string[] = []
  for (const key of imageKeys(data)) {
    if (v.safeParse(IconImageSchema, await deps.local.get(key)).success) rebuilt.push(key)
  }
  return rebuilt
}

// Borra imágenes de storage.local y las quita del índice. Primero las imágenes: si el índice no se puede escribir
// solo cuenta de más, nunca de menos. Va en la cola.
export async function removeLocalImages(deps: SwDeps, data: LauncherData, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  const index = await readIconIndex(deps, data)
  await deps.local.remove(keys)
  const gone = new Set(keys)
  await deps.local.set({ [LOCAL_KEYS.iconIndex]: index.filter((key) => !gone.has(key)) })
}
