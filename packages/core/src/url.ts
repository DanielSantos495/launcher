import { err, ok, type Result } from './result'
import { hasControlChars } from './text'

export const MAX_URL_LENGTH = 2048

export type UrlError = 'invalid' | 'scheme' | 'host' | 'userinfo' | 'length' | 'chars'

export interface UrlPolicy {
  readonly allowHttp: boolean
}

// Tras serializar con WHATWG URL (espacios → %20, dominios Unicode → punycode) solo queda ASCII imprimible.
// El host rechaza cualquier otro carácter, así que aquí se exige lo mismo (T2).
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/

// normalizeUrl valida una URL que se va a abrir y devuelve su forma canónica.
// Los caracteres de control se rechazan antes de parsear: el parser WHATWG eliminaría tabuladores y saltos de línea sin avisar.
export function normalizeUrl(input: string, policy: UrlPolicy): Result<string, UrlError> {
  const raw = input.trim()
  if (raw === '') return err('invalid')
  if (raw.length > MAX_URL_LENGTH) return err('length')
  if (hasControlChars(raw)) return err('chars')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return err('invalid')
  }
  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) return err('scheme')
  if (url.hostname === '') return err('host')
  if (url.username !== '' || url.password !== '') return err('userinfo')
  const href = url.href
  if (href.length > MAX_URL_LENGTH) return err('length')
  if (!PRINTABLE_ASCII.test(href)) return err('chars')
  return ok(href)
}
