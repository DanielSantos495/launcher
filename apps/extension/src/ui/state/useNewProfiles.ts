import type { Bindings, ProfileInfo } from '@account-launcher/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LauncherClient } from '../client'
import { markSeen, reviewProfiles } from '../lib/new-profiles'

// Perfiles del host cuya carpeta no se había visto (Varios perfiles con el programa disponible). Las carpetas vistas se
// guardan en storage.local; la primera vez se marcan todas sin avisar. Descartar un aviso lo marca como visto.
export function useNewProfiles(
  client: LauncherClient,
  enabled: boolean,
  profiles: readonly ProfileInfo[],
  bindings: Bindings,
): { readonly fresh: readonly ProfileInfo[]; readonly dismiss: (directory: string) => void } {
  const [fresh, setFresh] = useState<readonly ProfileInfo[]>([])
  // Lista de vistas en memoria: evita leer el almacén en cada refresco y aplica los descartes sin esperar.
  const seen = useRef<string[] | undefined>(undefined)
  const loaded = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setFresh([])
      return
    }
    const run = { cancelled: false }
    // Función aparte: TypeScript no estrecha su resultado entre los await (el efecto puede cancelarse mientras espera).
    const stopped = (): boolean => run.cancelled
    void (async () => {
      if (!loaded.current) {
        seen.current = await client.seenProfiles()
        loaded.current = true
      }
      if (stopped()) return
      const bound = new Set<string>()
      for (const binding of Object.values(bindings)) {
        if (binding.kind === 'chromium-profile') bound.add(binding.profileDirectory)
      }
      const review = reviewProfiles(profiles, seen.current, bound)
      if (review.nextSeen !== undefined) {
        seen.current = review.nextSeen
        await client.saveSeenProfiles(review.nextSeen)
      }
      if (!stopped()) setFresh(review.fresh)
    })()
    return () => {
      run.cancelled = true
    }
  }, [client, enabled, profiles, bindings])

  const dismiss = useCallback(
    (directory: string): void => {
      seen.current = markSeen(seen.current ?? [], [directory])
      setFresh((current) => current.filter((profile) => profile.directory !== directory))
      void client.saveSeenProfiles(seen.current)
    },
    [client],
  )

  return { fresh, dismiss }
}
