import { HOST_ERROR_CODES, UI_ERROR_CODES } from '@account-launcher/protocol'
import { HINTS } from '../../background/hints'
import type { MessageKey, Translator } from '../../i18n/i18n'

// Tablas cerradas código → clave y pista → clave. Si falta el texto de un código o de una pista, no compila (MessageKey).
const ERROR_KEYS: ReadonlyMap<string, MessageKey> = new Map(
  [...UI_ERROR_CODES, ...HOST_ERROR_CODES].map((code) => [code, `error.${code}`]),
)
const HINT_KEYS: ReadonlyMap<string, MessageKey> = new Map(HINTS.map((hint) => [hint, `hint.${hint}`]))

// Texto de un error del service worker. El título dice qué pasó y la pista, si hay, cómo arreglarlo. Un código o una
// pista fuera del vocabulario cerrado cae en el error interno o se omite: nunca se muestra texto recibido. El tipo del
// parámetro es más ancho que UiError para poder probar valores fuera del vocabulario.
export function errorText(
  error: { readonly code: string; readonly hint?: string | undefined },
  t: Translator['t'],
): { readonly title: string; readonly detail?: string } {
  const title = t(ERROR_KEYS.get(error.code) ?? 'error.internal')
  const hintKey = error.hint === undefined ? undefined : HINT_KEYS.get(error.hint)
  return hintKey === undefined ? { title } : { title, detail: t(hintKey) }
}
