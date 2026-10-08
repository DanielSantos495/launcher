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
  ])('rechaza %j con %s', (input, code) => {
    expect(normalizeUrl(input, httpsOnly)).toEqual({ ok: false, error: code })
  })

  it('acepta http solo si allowHttp', () => {
    expect(normalizeUrl('http://intranet.example/', { allowHttp: true })).toEqual({
      ok: true,
      value: 'http://intranet.example/',
    })
  })

  it('rechaza la URL si al codificarla supera la longitud máxima', () => {
    expect(normalizeUrl('https://example.com/' + 'ñ'.repeat(700), httpsOnly)).toEqual({ ok: false, error: 'length' })
  })
})

describe('hasControlChars', () => {
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
