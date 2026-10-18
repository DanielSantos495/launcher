import { IdSchema, ProfileDirectorySchema } from '@account-launcher/core'
import { TokenSchema } from '@account-launcher/protocol'
import * as v from 'valibot'
import type { SwDeps } from '../background/deps'
import { iconCacheOf } from '../background/icon-cache'
import { LOCAL_KEYS, SESSION_KEYS } from './keys'

export interface Installation {
  readonly installationId: string
  readonly paired: boolean
  readonly ownIdentityId?: string
  readonly ownProfileDirectory?: string
}

// El dashboard lee `installation` directamente; el token vive aparte en `pairing` y la UI nunca lo lee (DC5).
export const InstallationSchema = v.strictObject({
  installationId: IdSchema,
  paired: v.boolean(),
  ownIdentityId: v.optional(IdSchema),
  ownProfileDirectory: v.optional(ProfileDirectorySchema),
})

export const PairingSchema = v.strictObject({ token: TokenSchema })

// Lee la instalación; si falta o no valida, crea una nueva, la guarda y borra `pairing`: un token sin instalación
// válida no se usa. Se llama dentro de la cola.
export async function ensureInstallation(deps: SwDeps): Promise<Installation> {
  const stored = v.safeParse(InstallationSchema, await deps.local.get(LOCAL_KEYS.installation))
  if (stored.success) return stored.output
  const created: Installation = { installationId: deps.randomId(), paired: false }
  await deps.local.set({ [LOCAL_KEYS.installation]: created })
  await deps.local.remove([LOCAL_KEYS.pairing])
  return created
}

// El token solo cuenta si la instalación está emparejada y `pairing` valida con su esquema estricto.
export async function readToken(deps: SwDeps, installation: Installation): Promise<string | undefined> {
  if (!installation.paired) return undefined
  const pairing = v.safeParse(PairingSchema, await deps.local.get(LOCAL_KEYS.pairing))
  return pairing.success ? pairing.output.token : undefined
}

// Instalación y token en una sola llamada: nunca queda uno sin el otro.
export async function savePairing(deps: SwDeps, installation: Installation, token: string): Promise<Installation> {
  const paired: Installation = { ...installation, paired: true }
  // La caché de sesión (datos e imágenes) es de un token anterior: con el nuevo no debe servirse.
  // Es solo caché: si falla, no se pierde el token que acaba de dar el host.
  try {
    await deps.session.remove([SESSION_KEYS.shared])
    await iconCacheOf(deps.session).clear()
  } catch {
    // se ignora a propósito
  }
  await deps.local.set({ [LOCAL_KEYS.installation]: paired, [LOCAL_KEYS.pairing]: { token } })
  return paired
}

// Primero se borra el token; después la instalación pasa a no emparejada y se descarta la caché compartida.
export async function clearPairing(deps: SwDeps, installation: Installation): Promise<Installation> {
  await deps.local.remove([LOCAL_KEYS.pairing])
  const unpaired: Installation = { ...installation, paired: false }
  await deps.local.set({ [LOCAL_KEYS.installation]: unpaired })
  await deps.session.remove([SESSION_KEYS.shared])
  // Las imágenes cacheadas eran de ese token: se descartan con el índice de la caché.
  await iconCacheOf(deps.session).clear()
  return unpaired
}

export async function saveInstallation(deps: SwDeps, installation: Installation): Promise<void> {
  await deps.local.set({ [LOCAL_KEYS.installation]: installation })
}
