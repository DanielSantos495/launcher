import { describe, expect, it } from 'vitest'
import { hasControlChars } from '../src/text'
import { MAX_URL_LENGTH, normalizeUrl } from '../src/url'

const httpsOnly = { allowHttp: false }

describe('normalizeUrl', () => {
  it.each([
    ['https://github.com', 'https://github.com/'],
    ['  https://example.com/a b  ', 'https://example.com/a%20b'],
    ['https://bücher.de/', 'https://xn--bcher-kva.de/'],
    ['https://example.com/?q=ñ', 'https://example.com/?q=%C3%B1'],
    [
      'https://mail.google.com/mail/?authuser=ana%40example.com',
      'https://mail.google.com/mail/?authuser=ana%40example.com',
    ],
  ])('acepta %s', (input, expected) => {
    expect(normalizeUrl(input, httpsOnly)).toEqual({ ok: true, value: expected })
  })

  it.each([
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
  ])('rechaza %j con %s', (input, code) => {
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
