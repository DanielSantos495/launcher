import type { ProfileInfo } from '@account-launcher/core'

// Tope de carpetas vistas que se guardan en storage.local; al pasarse se descartan las más antiguas.
export const SEEN_LIMIT = 200

export interface ProfileReview {
  // Perfiles de los que avisar: carpeta no vista y sin vínculo.
  readonly fresh: readonly ProfileInfo[]
  // Lista a guardar como vista; undefined si no hay nada que guardar.
  readonly nextSeen: string[] | undefined
}

// Añade carpetas a la lista de vistas sin repetir, conservando el orden y el tope (se pierden las más antiguas).
export function markSeen(seen: readonly string[], directories: readonly string[]): string[] {
  const known = new Set(seen)
  const added = directories.filter(
    (directory, index) => !known.has(directory) && directories.indexOf(directory) === index,
  )
  return [...seen, ...added].slice(-SEEN_LIMIT)
}

// Compara la lista de perfiles del host con las carpetas vistas. La primera vez (seen undefined) marca todas como vistas
// sin avisar; con la lista vacía no guarda nada, porque aún puede no haberse leído (la UI parte de una lista vacía).
export function reviewProfiles(
  profiles: readonly ProfileInfo[],
  seen: readonly string[] | undefined,
  bound: ReadonlySet<string>,
): ProfileReview {
  if (seen === undefined) {
    return profiles.length === 0
      ? { fresh: [], nextSeen: undefined }
      : {
          fresh: [],
          nextSeen: markSeen(
            [],
            profiles.map((profile) => profile.directory),
          ),
        }
  }
  const known = new Set(seen)
  // Las carpetas con vínculo cuentan como vistas: si se desvinculan, el aviso no debe volver.
  const linked = profiles.map((profile) => profile.directory).filter((directory) => bound.has(directory))
  const added = markSeen(seen, linked)
  return {
    fresh: profiles.filter((profile) => !known.has(profile.directory) && !bound.has(profile.directory)),
    nextSeen:
      added.length === seen.length && added.every((directory, index) => directory === seen[index]) ? undefined : added,
  }
}
