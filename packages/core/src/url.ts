import { err, ok, type Result } from './result'
import { hasControlChars, isWellFormed } from './text'

export const MAX_URL_LENGTH = 2048

export type UrlError = 'invalid' | 'scheme' | 'host' | 'userinfo' | 'length' | 'chars'

export interface UrlPolicy {
  readonly allowHttp: boolean
}

// Gramática G (contrato con el host, ADR-004 y packages/protocol/fixtures/README.md): la forma exacta de las URLs que
// la extensión envía y que el host en Go comprueba tal cual, sin serializador WHATWG. normalizeUrl la cumple por
// construcción: serializa con WHATWG y rechaza lo que no esté en G. Todo lo que está en G es canónico para WHATWG
// (new URL(s).href === s), con una excepción: una etiqueta xn-- con punycode no válido está en G pero WHATWG la
// rechaza (new URL lanza), así que no tiene otra forma canónica; normalizeUrl nunca la produce.
// Clases de caracteres comprobadas con Node 22.22.3 (ada 2.9.2): son las que WHATWG deja sin codificar en cada
// componente con un esquema especial; el host las comprueba igual.
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/
const IPV4_PART = '(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])'
// IPv4 canónica: cuatro decimales de 0 a 255 sin ceros a la izquierda.
const IPV4 = new RegExp(`^${IPV4_PART}(?:\\.${IPV4_PART}){3}$`)
const LABEL = /^[a-z0-9_-]{1,63}$/
const DIGITS = /^[0-9]+$/
const PORT = /^[1-9][0-9]{0,4}$/
const HEX2 = /^[0-9A-Fa-f]{2}$/
// Además del espacio y de lo que no es ASCII imprimible, cada componente excluye estos caracteres.
const PATH_EXCLUDED = '"#<>?`{}\\'
const QUERY_EXCLUDED = `"#<>'`
const FRAGMENT_EXCLUDED = '"<>`'
// Segmentos que WHATWG resuelve como "." o "..", en minúsculas.
const DOT_SEGMENTS: readonly string[] = ['.', '..', '%2e', '.%2e', '%2e.', '%2e%2e']

// Dominio de etiquetas [a-z0-9_-]{1,63} separadas por "." (se admite un "." final) o IPv4 canónica. La última etiqueta
// no puede ser solo dígitos ni empezar por 0x: WHATWG leería el host como una IPv4 y lo reescribiría. Sin IPv6.
function isGrammarHost(host: string): boolean {
  if (IPV4.test(host)) return true
  const labels = (host.endsWith('.') ? host.slice(0, -1) : host).split('.')
  const last = labels.at(-1) ?? ''
  return labels.every((label) => LABEL.test(label)) && !DIGITS.test(last) && !last.startsWith('0x')
}

// Puerto de 1 a 65535 sin ceros a la izquierda y distinto del puerto por defecto del esquema (WHATWG lo quitaría).
function isGrammarPort(port: string, scheme: 'https' | 'http'): boolean {
  return PORT.test(port) && Number(port) <= 65535 && port !== (scheme === 'https' ? '443' : '80')
}

// true si el componente tiene un carácter excluido o un "%" que no va seguido de dos dígitos hexadecimales.
function hasBadChars(component: string, excluded: string): boolean {
  for (let i = 0; i < component.length; i++) {
    const ch = component.charAt(i)
    if (excluded.includes(ch)) return true
    if (ch === '%' && !HEX2.test(component.slice(i + 1, i + 3))) return true
  }
  return false
}

// Devuelve por qué href no está en G, o undefined si está. Códigos: 'chars' para caracteres y "%", 'host' para el
// host, 'invalid' para el resto (sin ruta, puerto, segmentos punto).
function grammarError(href: string): UrlError | undefined {
  if (href.length > MAX_URL_LENGTH) return 'length'
  if (!PRINTABLE_ASCII.test(href)) return 'chars'
  const scheme = href.startsWith('https://') ? 'https' : href.startsWith('http://') ? 'http' : undefined
  if (scheme === undefined) return 'scheme'
  const rest = href.slice(scheme.length + '://'.length)
  // La autoridad (host y puerto) acaba en el primer "/", "?" o "#", y la ruta es obligatoria.
  const end = rest.search(/[/?#]/)
  if (end === -1 || rest.charAt(end) !== '/') return 'invalid'
  const authority = rest.slice(0, end)
  const colon = authority.indexOf(':')
  if (!isGrammarHost(colon === -1 ? authority : authority.slice(0, colon))) return 'host'
  if (colon !== -1 && !isGrammarPort(authority.slice(colon + 1), scheme)) return 'invalid'
  // El primer "#" abre el fragmento y, antes de él, el primer "?" abre la consulta.
  const tail = rest.slice(end)
  const hash = tail.indexOf('#')
  const beforeHash = hash === -1 ? tail : tail.slice(0, hash)
  const question = beforeHash.indexOf('?')
  const path = question === -1 ? beforeHash : beforeHash.slice(0, question)
  if (hasBadChars(path, PATH_EXCLUDED)) return 'chars'
  if (question !== -1 && hasBadChars(beforeHash.slice(question + 1), QUERY_EXCLUDED)) return 'chars'
  if (hash !== -1 && hasBadChars(tail.slice(hash + 1), FRAGMENT_EXCLUDED)) return 'chars'
  if (path.split('/').some((segment) => DOT_SEGMENTS.includes(segment.toLowerCase()))) return 'invalid'
  return undefined
}

// isUrlInGrammar dice si href está en G: es la comprobación del host (HostUrlSchema) y la última de normalizeUrl.
export function isUrlInGrammar(href: string): boolean {
  return grammarError(href) === undefined
}

// normalizeUrl valida una URL que se va a abrir y devuelve su forma canónica, que siempre está en G.
// trim() quita los espacios, tabuladores y saltos de línea de los extremos; el resto de caracteres de control
// (los internos y los demás de los extremos) se rechaza antes de parsear, porque el parser WHATWG eliminaría
// tabuladores y saltos de línea sin avisar.
export function normalizeUrl(input: string, policy: UrlPolicy): Result<string, UrlError> {
  const raw = input.trim()
  if (raw === '') return err('invalid')
  if (raw.length > MAX_URL_LENGTH) return err('length')
  // WHATWG sustituiría un sustituto suelto por U+FFFD sin avisar: se rechaza antes de parsear.
  if (hasControlChars(raw) || !isWellFormed(raw)) return err('chars')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return err('invalid')
  }
  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) return err('scheme')
  if (url.username !== '' || url.password !== '') return err('userinfo')
  // Tras serializar (espacios → %20, dominios Unicode → punycode) queda la forma canónica; G descarta lo que WHATWG
  // admite pero el contrato no: "%" mal formado, hosts con otros caracteres, IPv6, puerto 0…
  const href = url.href
  const problem = grammarError(href)
  return problem === undefined ? ok(href) : err(problem)
}
