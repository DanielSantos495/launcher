import { TimestampSchema } from '@account-launcher/core'
import { NonceSchema, type UiResponse } from '@account-launcher/protocol'
import * as v from 'valibot'
import type { WhoamiResult } from '../background/internal-messages'

// Tiempo que se deja visible el resultado antes de cerrar la pestaña.
const CLOSE_DELAY_MS = 1500

export type WhoamiState = 'checking' | 'verified' | 'failed' | 'invalid'

// El host pone el nonce en el fragmento de la URL: '#' + NonceSchema. Cualquier otra cosa no es un nonce.
export function parseNonce(hash: string): string | null {
  if (!hash.startsWith('#')) return null
  const nonce = hash.slice(1)
  return v.safeParse(NonceSchema, nonce).success ? nonce : null
}

const SuccessSchema = v.strictObject({
  ok: v.literal(true),
  result: v.strictObject({ verifiedAt: TimestampSchema }),
})

// La respuesta del service worker llega sin tipo: solo una respuesta correcta con la forma esperada cuenta como tal.
// El motivo de un fallo no se muestra (la página nunca enseña códigos ni el nonce), así que no se conserva.
export function toWhoamiResponse(raw: unknown): UiResponse<WhoamiResult> {
  const parsed = v.safeParse(SuccessSchema, raw)
  return parsed.success ? parsed.output : { ok: false, error: { code: 'internal' } }
}

export interface WhoamiEnv {
  readonly hash: string
  readonly send: (message: { type: 'whoami.prove'; nonce: string }) => Promise<UiResponse<WhoamiResult>>
  readonly clearHash: () => void // history.replaceState sin el fragmento
  readonly render: (state: WhoamiState) => void
  readonly closeTab: () => Promise<void> // tabs.getCurrent + tabs.remove (sin permiso tabs, [Medido])
  readonly sleep: (ms: number) => Promise<void>
}

// Prueba de identidad del perfil (T18, §4.7): reenvía el nonce al service worker de este perfil, que lo prueba al host.
// El nonce se quita de la URL antes de enviarlo y no se muestra nunca.
export async function runWhoami(env: WhoamiEnv): Promise<void> {
  const nonce = parseNonce(env.hash)
  if (nonce === null) {
    env.render('invalid')
    return
  }
  env.clearHash()
  env.render('checking')
  let response: UiResponse<WhoamiResult>
  try {
    response = await env.send({ type: 'whoami.prove', nonce })
  } catch {
    // El service worker no respondió (por ejemplo, la extensión se está recargando).
    env.render('failed')
    return
  }
  if (!response.ok) {
    env.render('failed')
    return
  }
  env.render('verified')
  await env.sleep(CLOSE_DELAY_MS)
  try {
    await env.closeTab()
  } catch {
    // Si no se puede cerrar, la página sigue diciendo que el perfil está verificado y que se puede cerrar a mano.
    return
  }
}
