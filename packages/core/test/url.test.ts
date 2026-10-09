import { describe, expect, it } from 'vitest'
import { hasControlChars } from '../src/text'
import { isUrlInGrammar, MAX_URL_LENGTH, normalizeUrl } from '../src/url'

const httpsOnly = { allowHttp: false }

// Entradas y salidas de estas pruebas: forman parte del corpus de la prueba de propiedad de G (más abajo).
const ACCEPTED: [string, string][] = [
  ['https://github.com', 'https://github.com/'],
  ['  https://example.com/a b  ', 'https://example.com/a%20b'],
  ['https://bücher.de/', 'https://xn--bcher-kva.de/'],
  ['https://example.com/?q=ñ', 'https://example.com/?q=%C3%B1'],
  [
    'https://mail.google.com/mail/?authuser=ana%40example.com',
    'https://mail.google.com/mail/?authuser=ana%40example.com',
  ],
  // "%" bien formado, en minúsculas: WHATWG no cambia las mayúsculas de los escapes (A1).
  ['https://example.com/%7e', 'https://example.com/%7e'],
  // Formas que WHATWG reescribe: normalizeUrl devuelve la canónica, que está en G (el host rechaza las originales).
  ['https://example.com/{x}', 'https://example.com/%7Bx%7D'],
  ['https://example.com/a"b', 'https://example.com/a%22b'],
  ["https://example.com/?q='", 'https://example.com/?q=%27'],
  ['https://example.com/#a`b', 'https://example.com/#a%60b'],
  ['https://010.0.0.1/', 'https://8.0.0.1/'],
  ['https://example.com:0443/', 'https://example.com/'],
  // Caracteres que WHATWG deja sin codificar y G admite.
  ['https://example.com/?q={x}', 'https://example.com/?q={x}'],
  ['https://example.com/^x', 'https://example.com/^x'],
  ['https://example.com/|x', 'https://example.com/|x'],
  ['https://example.com./', 'https://example.com./'],
  ['https://example.com:8080/', 'https://example.com:8080/'],
]

const REJECTED: [string, string][] = [
  ['', 'invalid'],
  ['   ', 'invalid'],
  ['not a url', 'invalid'],
  ['--incognito', 'invalid'],
  ['https://exa mple.com', 'invalid'],
  ['javascript:alert(1)', 'scheme'],
  ['data:text/html,hola', 'scheme'],
  ['file:///etc/passwd', 'scheme'],
  ['chrome://settings', 'scheme'],
  ['http://example.com', 'scheme'],
  ['https://user:pass@example.com', 'userinfo'],
  ['https://user@example.com', 'userinfo'],
  ['https://example.com/\n--incognito', 'chars'],
  ['https://example.com/\tx', 'chars'],
  ['https://example.com/\u0085', 'chars'],
  ['https://example.com/' + 'a'.repeat(MAX_URL_LENGTH), 'length'],
  // El carácter de control del extremo que trim() no quita (solo quita espacios, tabuladores y saltos de línea).
  ['https://example.com/\u0001', 'chars'],
  ['\u007fhttps://example.com/', 'chars'],
  // "%" mal formado (A1): WHATWG lo deja tal cual, G no lo admite.
  ['https://example.com/%zz', 'chars'],
  ['https://example.com/%', 'chars'],
  ['https://example.com/%2', 'chars'],
  ['https://example.com/%G0', 'chars'],
  ['https://example.com/%%41', 'chars'],
  ['https://example.com/?q=%zz', 'chars'],
  ['https://example.com/#%zz', 'chars'],
  // Formas canónicas para WHATWG que G no admite (B2).
  ['https://a!b.example/', 'host'],
  ['https://a{b}.example/', 'host'],
  ['https://[::1]/', 'host'],
  ['https://a..b/', 'host'],
  ['https://a.0xg/', 'host'],
  [`https://${'a'.repeat(64)}.example/`, 'host'],
  ['https://example.com:0/', 'invalid'],
]

describe('normalizeUrl', () => {
  it.each(ACCEPTED)('acepta %s', (input, expected) => {
    expect(normalizeUrl(input, httpsOnly)).toEqual({ ok: true, value: expected })
  })

  it.each(REJECTED)('rechaza %j con %s', (input, code) => {
    expect(normalizeUrl(input, httpsOnly)).toEqual({ ok: false, error: code })
  })

  it('acepta http solo si allowHttp', () => {
    expect(normalizeUrl('http://intranet.example/', { allowHttp: true })).toEqual({
      ok: true,
      value: 'http://intranet.example/',
    })
  })

  it('con allowHttp solo se añade http: los demás esquemas siguen rechazados', () => {
    expect(normalizeUrl('ftp://example.com/', { allowHttp: true })).toEqual({ ok: false, error: 'scheme' })
  })

  it('quita espacios, tabuladores y saltos de línea de los extremos y rechaza los internos', () => {
    expect(normalizeUrl('\t https://github.com/\r\n', httpsOnly)).toEqual({ ok: true, value: 'https://github.com/' })
    expect(normalizeUrl('https://github.com/\n', httpsOnly).ok).toBe(true)
    expect(normalizeUrl('https://git\nhub.com/', httpsOnly)).toEqual({ ok: false, error: 'chars' })
  })

  it('rechaza un sustituto suelto antes de parsear', () => {
    // WHATWG lo sustituiría por U+FFFD (%EF%BF%BD) sin avisar: se rechaza antes de new URL.
    expect(normalizeUrl('https://example.com/\ud800', { allowHttp: false })).toEqual({ ok: false, error: 'chars' })
  })

  it('acepta un emoji bien formado y lo codifica', () => {
    expect(normalizeUrl('https://example.com/😀', { allowHttp: false })).toEqual({
      ok: true,
      value: 'https://example.com/%F0%9F%98%80',
    })
  })

  it('rechaza la URL si al codificarla supera la longitud máxima', () => {
    expect(normalizeUrl('https://example.com/' + 'ñ'.repeat(700), httpsOnly)).toEqual({ ok: false, error: 'length' })
  })

  describe('frontera de longitud', () => {
    const base = 'https://example.com/'

    it('acepta 2048 caracteres y rechaza 2049', () => {
      const exact = base + 'a'.repeat(MAX_URL_LENGTH - base.length)
      expect(exact).toHaveLength(MAX_URL_LENGTH)
      expect(normalizeUrl(exact, httpsOnly)).toEqual({ ok: true, value: exact })
      expect(normalizeUrl(exact + 'a', httpsOnly)).toEqual({ ok: false, error: 'length' })
    })

    it('acepta la URL que llega a 2048 justos tras codificar y rechaza un carácter más', () => {
      // Cada "ñ" ocupa 6 caracteres codificada (%C3%B1): 20 + 338 x 6 = 2048.
      const exact = base + 'ñ'.repeat((MAX_URL_LENGTH - base.length) / 6)
      expect(exact.length).toBeLessThan(MAX_URL_LENGTH)
      const accepted = normalizeUrl(exact, httpsOnly)
      expect(accepted.ok && accepted.value).toHaveLength(MAX_URL_LENGTH)
      expect(normalizeUrl(exact + 'a', httpsOnly)).toEqual({ ok: false, error: 'length' })
    })
  })
})

describe('hasControlChars', () => {
  it.each([
    ['U+0000', 0x00, true],
    ['U+001F', 0x1f, true],
    ['U+0020', 0x20, false],
    ['U+007E', 0x7e, false],
    ['U+007F', 0x7f, true],
    ['U+009F', 0x9f, true],
    ['U+00A0', 0xa0, false],
  ])('frontera %s', (_name, code, expected) => {
    expect(hasControlChars(`a${String.fromCodePoint(code)}b`)).toBe(expected)
  })

  it('detecta C0, DEL y C1', () => {
    expect(hasControlChars('a\u0000b')).toBe(true)
    expect(hasControlChars('a\u007fb')).toBe(true)
    expect(hasControlChars('a\u009fb')).toBe(true)
    expect(hasControlChars('Diseño 🎨')).toBe(false)
  })
  it('permite los caracteres indicados', () => {
    expect(hasControlChars('línea 1\nlínea 2\tfin', '\n\t')).toBe(false)
    expect(hasControlChars('a\rb', '\n\t')).toBe(true)
  })
})

describe('isUrlInGrammar (gramática G)', () => {
  it.each([
    'https://example.com/',
    'http://example.com/',
    'https://xn--bcher-kva.de/',
    'https://a_b-c.example/',
    'https://example.com./',
    'https://1.2.3.4/',
    'https://255.255.255.255/',
    'https://0.0.0.0/',
    'https://1.2.3.4x/',
    'https://example.com:1/',
    'https://example.com:65535/',
    'https://example.com:80/',
    'http://example.com:443/',
    "https://example.com/!$&'()*+,;=:@[]^|~-._%41",
    'https://example.com//x',
    'https://example.com/...',
    'https://example.com/%2e.%2e',
    'https://example.com/?',
    'https://example.com/?a?b=`{}\\^|[]!$&()*+,;=:@/~',
    'https://example.com/#',
    "https://example.com/#a#b?c'{}\\^|[]",
  ])('acepta %s, que es canónica', (href) => {
    expect(isUrlInGrammar(href)).toBe(true)
    expect(new URL(href).href).toBe(href)
  })

  it.each([
    ['vacía', ''],
    ['más de 2048 caracteres', `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`],
    ['espacio', 'https://example.com/a b'],
    ['no ASCII', 'https://example.com/ñ'],
    ['esquema en mayúsculas', 'HTTPS://example.com/'],
    ['otro esquema', 'ftp://example.com/'],
    ['sin ruta', 'https://example.com'],
    ['consulta sin ruta', 'https://example.com?q'],
    ['host en mayúsculas', 'https://Example.com/'],
    ['host vacío', 'https:///x'],
    ['etiqueta vacía', 'https://a..b/'],
    ['etiqueta de 64', `https://${'a'.repeat(64)}.example/`],
    ['solo un punto', 'https://./'],
    ['dos puntos finales', 'https://example.com../'],
    ['última etiqueta numérica', 'https://example.1/'],
    ['última etiqueta numérica antes del punto final', 'https://1.2.3.4./'],
    ['última etiqueta 0x', 'https://a.0xg/'],
    ['IPv4 con cero a la izquierda', 'https://010.0.0.1/'],
    ['IPv4 hexadecimal', 'https://0x7f.0.0.1/'],
    ['IPv4 de tres partes', 'https://1.2.3/'],
    ['IPv4 fuera de rango', 'https://256.0.0.1/'],
    ['IPv6', 'https://[::1]/'],
    ['host con !', 'https://a!b.example/'],
    ['userinfo', 'https://user@example.com/'],
    ['puerto vacío', 'https://example.com:/'],
    ['puerto 0', 'https://example.com:0/'],
    ['puerto con cero a la izquierda', 'https://example.com:0443/'],
    ['puerto 65536', 'https://example.com:65536/'],
    ['puerto por defecto https', 'https://example.com:443/'],
    ['puerto por defecto http', 'http://example.com:80/'],
    ['ruta con {', 'https://example.com/{x}'],
    ['ruta con "', 'https://example.com/a"b'],
    ['ruta con <', 'https://example.com/<x>'],
    ['ruta con `', 'https://example.com/`x'],
    ['ruta con \\', 'https://example.com/a\\b'],
    ['ruta con % mal formado', 'https://example.com/%zz'],
    ['ruta con % final', 'https://example.com/%'],
    ['segmento .', 'https://example.com/a/./b'],
    ['segmento ..', 'https://example.com/a/../b'],
    ['segmento %2e', 'https://example.com/%2e/b'],
    ['segmento .%2E', 'https://example.com/.%2E/b'],
    ['segmento %2E.', 'https://example.com/%2E./b'],
    ['segmento %2e%2E final', 'https://example.com/a/%2e%2E'],
    ["consulta con '", "https://example.com/?q='"],
    ['consulta con "', 'https://example.com/?q="'],
    ['consulta con <', 'https://example.com/?q=<'],
    ['consulta con % mal formado', 'https://example.com/?q=%G0'],
    ['fragmento con `', 'https://example.com/#a`b'],
    ['fragmento con >', 'https://example.com/#a>b'],
    ['fragmento con % mal formado', 'https://example.com/#%2'],
  ])('rechaza %s', (_name, href) => {
    expect(isUrlInGrammar(href)).toBe(false)
  })
})

// Propiedad de G (B2): para todo el corpus, (1) si normalizeUrl acepta, el resultado está en G, y (2) toda cadena que
// está en G es canónica para WHATWG (new URL(s).href === s) y normalizeUrl la devuelve igual. La única excepción a (2)
// es una etiqueta xn-- con punycode inválido: está en G y WHATWG la rechaza (new URL lanza), sin otra forma canónica.
describe('gramática G: propiedad sobre un corpus amplio', () => {
  const PRINTABLE = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i))
  const SCHEMES = ['https://', 'http://', 'HTTPS://', 'ftp://']
  const HOSTS = [
    'example.com',
    'Example.COM',
    'a.b.c',
    'localhost',
    '-',
    '_',
    'a_b-c',
    'ab--cd.example',
    '1a.example',
    'a.1a',
    'a.0xg',
    'a.0x',
    '0x.example',
    '0x7f',
    'example.com.',
    'a..b',
    '.a.example',
    'a.example..',
    `${'a'.repeat(63)}.example`,
    `${'a'.repeat(64)}.example`,
    '1.2.3.4',
    '0.0.0.0',
    '255.255.255.255',
    '256.0.0.1',
    '010.0.0.1',
    '0x7f.0.0.1',
    '1.2.3',
    '127.1',
    '1.2.3.4.',
    '1.2.3.04',
    '1.2.3.4x',
    'x.09',
    '[::1]',
    '[0:0:0:0:0:0:0:1]',
    'bücher.de',
    'xn--bcher-kva.de',
    'xn--tda.example',
    'xn--a.example',
    'xn--zz.example',
    'a%41b.example',
    'user@example.com',
  ]
  const PORTS = ['', ':', ':0', ':1', ':80', ':443', ':0443', ':8080', ':08080', ':65535', ':65536']
  const PATHS = [
    '',
    '/',
    '/a/b',
    '//x',
    '/a/./b',
    '/a/../b',
    '/%2e%2e/x',
    '/a/.%2E/b',
    '/a/%2e./b',
    '/...',
    '/%2e.%2e',
    '/%zz',
    '/%',
    '/%2',
    '/%G0',
    '/%%41',
    '/%7e',
    '/%7E',
    '/a b',
    '/ñ',
    ...PRINTABLE.map((c) => `/x${c}y`),
  ]
  const QUERIES = ['', '?', '?a?b', '?q=%zz', '?q=%41', '?q=ñ', '?q= ', ...PRINTABLE.map((c) => `?q=${c}y`)]
  const FRAGMENTS = ['', '#', '#a#b', '#a?b', '#%zz', '#%41', '#ñ', ...PRINTABLE.map((c) => `#x${c}y`)]

  // Generador determinista (mulberry32): el corpus es el mismo en cada ejecución.
  function seeded(seed: number): () => number {
    let a = seed
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const random = seeded(20261008)
  const pick = (list: readonly string[]): string => list[Math.floor(random() * list.length)] ?? ''

  const corpus = new Set<string>()
  for (const scheme of SCHEMES) {
    for (const host of HOSTS) for (const port of PORTS) corpus.add(`${scheme}${host}${port}/`)
  }
  for (const c of PRINTABLE) corpus.add(`https://a${c}b.example/`)
  for (const path of PATHS) {
    corpus.add(`https://example.com${path}`)
    corpus.add(`http://example.com${path}`)
  }
  for (const query of QUERIES) corpus.add(`https://example.com/${query}`)
  for (const fragment of FRAGMENTS) corpus.add(`https://example.com/${fragment}`)
  for (let n = 0; n < 600; n++) {
    corpus.add(pick(SCHEMES) + pick(HOSTS) + pick(PORTS) + pick(PATHS) + pick(QUERIES) + pick(FRAGMENTS))
  }
  for (const [input, output] of [...ACCEPTED, ...REJECTED]) {
    corpus.add(input)
    corpus.add(output)
  }

  const whatwg = (s: string): string | undefined => {
    try {
      return new URL(s).href
    } catch {
      return undefined
    }
  }
  const hasPunycodeLabel = (s: string) => /^https?:\/\/(?:[^/?#]*\.)?xn--/.test(s)

  it('lo que acepta normalizeUrl está en G, y lo que está en G es canónico', () => {
    const violations: string[] = []
    let inGrammar = 0
    let canonicalOutsideGrammar = 0
    for (const s of corpus) {
      for (const allowHttp of [false, true]) {
        const r = normalizeUrl(s, { allowHttp })
        if (r.ok && !isUrlInGrammar(r.value)) violations.push(`normalizeUrl acepta fuera de G: ${s} → ${r.value}`)
      }
      const href = whatwg(s)
      if (isUrlInGrammar(s)) {
        inGrammar++
        if (href === undefined && hasPunycodeLabel(s)) continue
        if (href !== s) violations.push(`en G pero no canónica: ${s} → ${String(href)}`)
        const r = normalizeUrl(s, { allowHttp: true })
        if (!r.ok || r.value !== s) violations.push(`en G pero normalizeUrl no la devuelve igual: ${s}`)
      } else if (href === s && /^https?:\/\/[^@/?#]*\//.test(s)) {
        // Canónica para WHATWG pero fuera de G: normalizeUrl debe rechazarla (lo comprueba (1)).
        canonicalOutsideGrammar++
      }
    }
    expect(violations).toEqual([])
    // El corpus no es trivial: hay muchas cadenas dentro de G y muchas canónicas que G deja fuera.
    expect(corpus.size).toBeGreaterThan(2500)
    expect(inGrammar).toBeGreaterThan(400)
    expect(canonicalOutsideGrammar).toBeGreaterThan(80)
  })

  it('la única excepción: una etiqueta xn-- con punycode inválido está en G y WHATWG la rechaza', () => {
    for (const s of ['https://xn--a.example/', 'https://xn--zz.example/']) {
      expect(isUrlInGrammar(s)).toBe(true)
      expect(whatwg(s)).toBeUndefined()
      expect(normalizeUrl(s, httpsOnly)).toEqual({ ok: false, error: 'invalid' })
    }
  })
})
