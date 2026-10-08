import { describe, expect, it } from 'vitest'
import { expandTemplate, isValidTemplate } from '../src/template'

const policy = { allowHttp: false }

describe('expandTemplate', () => {
  it('sustituye y codifica los valores', () => {
    expect(expandTemplate('https://{username}.slack.com/', { username: 'acme' })).toBe('https://acme.slack.com/')
    expect(expandTemplate('https://x.example/u/{email}', { email: 'a b@example.com' })).toBe(
      'https://x.example/u/a%20b%40example.com',
    )
  })
  it('devuelve undefined si falta un valor', () => {
    expect(expandTemplate('https://{username}.slack.com/', {})).toBeUndefined()
    expect(expandTemplate('https://{username}.slack.com/', { username: '' })).toBeUndefined()
  })
  it('devuelve undefined, sin lanzar, si el valor no se puede codificar (sustituto suelto)', () => {
    expect(expandTemplate('https://x.example/u/{username}', { username: '\ud800' })).toBeUndefined()
    expect(expandTemplate('https://x.example/u/{email}', { email: 'a\udfff@example.com' })).toBeUndefined()
  })
})

describe('isValidTemplate', () => {
  it('acepta plantillas https con marcadores conocidos', () => {
    expect(isValidTemplate('https://{username}.slack.com/', policy)).toBe(true)
    expect(isValidTemplate('https://app.example.com/', policy)).toBe(true)
  })
  it('rechaza marcadores desconocidos, llaves sueltas y esquemas peligrosos', () => {
    expect(isValidTemplate('https://{tenant}.example.com/', policy)).toBe(false)
    expect(isValidTemplate('https://example.com/{', policy)).toBe(false)
    expect(isValidTemplate('javascript:alert({email})', policy)).toBe(false)
    expect(isValidTemplate('http://{username}.example.com/', policy)).toBe(false)
    expect(isValidTemplate('http://{username}.example.com/', { allowHttp: true })).toBe(true)
  })
})
