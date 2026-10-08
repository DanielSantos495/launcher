import { describe, expect, it } from 'vitest'
import { buildAccountUrl, CATALOG, serviceInfo, type CatalogId, type MultiAccount } from '../src/services'
import { CATALOG_IDS, type LauncherData } from '../src/schema'
import { account, data, identity, T0 } from './fixtures'

const slack = {
  id: 'slack',
  name: 'Slack',
  urlTemplate: 'https://{username}.slack.com/',
  multiAccount: 'parallel' as const,
  createdAt: T0,
  updatedAt: T0,
}

// Datos con http permitido (settings.allowHttp = true).
function withHttp(over: Partial<LauncherData> = {}): LauncherData {
  const base = data(over)
  return { ...base, settings: { ...base.settings, allowHttp: true } }
}

// multiAccount medido en F0 (§5.3).
const MEASURED: readonly (readonly [CatalogId, MultiAccount])[] = [
  ['google.gmail', 'parallel'],
  ['google.gemini', 'parallel'],
  ['github', 'switch'],
  ['claude', 'none'],
  ['chatgpt', 'none'],
  ['shopify', 'none'],
  ['cloudflare', 'none'],
  ['generic', 'none'],
]

describe('CATALOG', () => {
  it('cubre todos los ids del esquema', () => {
    expect(CATALOG.map((s) => s.id).sort()).toEqual([...CATALOG_IDS].sort())
  })

  it('la tabla de multiAccount medido cubre todos los ids', () => {
    expect(MEASURED.map(([id]) => id).sort()).toEqual([...CATALOG_IDS].sort())
  })

  it.each(MEASURED)('%s tiene multiAccount %s', (id, expected) => {
    expect(CATALOG.find((s) => s.id === id)?.multiAccount).toBe(expected)
  })
})

describe('buildAccountUrl', () => {
  it('Gmail usa authuser con el email de la identidad', () => {
    const a = account({ serviceId: 'google.gmail', label: 'Gmail' })
    expect(buildAccountUrl(data({ accounts: [a] }), a)).toEqual({
      ok: true,
      value: 'https://mail.google.com/mail/?authuser=ana%40example.com',
    })
  })

  it('Gmail prefiere el email del campo usuario', () => {
    const a = account({ serviceId: 'google.gmail', username: 'otra@example.com' })
    expect(buildAccountUrl(data({ accounts: [a] }), a)).toEqual({
      ok: true,
      value: 'https://mail.google.com/mail/?authuser=otra%40example.com',
    })
  })

  it('Gmail sin email abre la URL por defecto', () => {
    const a = account({ serviceId: 'google.gmail' })
    const d = data({ identities: [identity({ email: undefined })], accounts: [a] })
    expect(buildAccountUrl(d, a)).toEqual({ ok: true, value: 'https://mail.google.com/mail/' })
  })

  it('Gmail conserva una URL propia del mismo dominio y le añade authuser', () => {
    const a = account({ serviceId: 'google.gmail', url: 'https://mail.google.com/mail/u/0/#inbox' })
    expect(buildAccountUrl(data({ accounts: [a] }), a)).toEqual({
      ok: true,
      value: 'https://mail.google.com/mail/u/0/?authuser=ana%40example.com#inbox',
    })
  })

  it('Gemini usa authuser', () => {
    const a = account({ serviceId: 'google.gemini' })
    expect(buildAccountUrl(data({ accounts: [a] }), a)).toEqual({
      ok: true,
      value: 'https://gemini.google.com/app?authuser=ana%40example.com',
    })
  })

  it('GitHub usa la URL propia o la de por defecto', () => {
    const a = account()
    expect(buildAccountUrl(data({ accounts: [a] }), a)).toEqual({ ok: true, value: 'https://github.com/' })
    const b = account({ url: 'https://github.com/acme' })
    expect(buildAccountUrl(data({ accounts: [b] }), b)).toEqual({ ok: true, value: 'https://github.com/acme' })
  })

  it('el genérico necesita una URL válida', () => {
    const a = account({ serviceId: 'generic' })
    expect(buildAccountUrl(data(), a)).toEqual({ ok: false, error: 'no_url' })
    const b = account({ serviceId: 'generic', url: 'javascript:alert(1)' })
    expect(buildAccountUrl(data(), b)).toEqual({ ok: false, error: 'scheme' })
  })

  it('Gmail no añade authuser a una URL de otro dominio', () => {
    const a = account({ serviceId: 'google.gmail', url: 'https://example.org/mail/' })
    expect(buildAccountUrl(data({ accounts: [a] }), a)).toEqual({ ok: true, value: 'https://example.org/mail/' })
  })

  it('Gmail no añade authuser a un dominio que solo empieza por el de Google', () => {
    const a = account({ serviceId: 'google.gmail', url: 'https://mail.google.com.example.org/' })
    expect(buildAccountUrl(data({ accounts: [a] }), a)).toEqual({
      ok: true,
      value: 'https://mail.google.com.example.org/',
    })
  })

  it('Gmail rechaza una URL propia con caracteres de control, tenga o no email', () => {
    const a = account({ serviceId: 'google.gmail', url: 'https://mail.google.com/ma\til/' })
    expect(buildAccountUrl(data({ accounts: [a] }), a)).toEqual({ ok: false, error: 'chars' })
    const d = data({ identities: [identity({ email: undefined })], accounts: [a] })
    expect(buildAccountUrl(d, a)).toEqual({ ok: false, error: 'chars' })
  })

  it('el genérico solo admite http si settings.allowHttp está activo', () => {
    const a = account({ serviceId: 'generic', url: 'http://example.com/' })
    expect(buildAccountUrl(data({ accounts: [a] }), a)).toEqual({ ok: false, error: 'scheme' })
    expect(buildAccountUrl(withHttp({ accounts: [a] }), a)).toEqual({ ok: true, value: 'http://example.com/' })
  })

  it('una plantilla http solo se abre si settings.allowHttp está activo', () => {
    const http = { ...slack, urlTemplate: 'http://{username}.example.com/' }
    const a = account({ serviceId: 'custom:slack', username: 'acme' })
    expect(buildAccountUrl(data({ customServices: [http], accounts: [a] }), a)).toEqual({
      ok: false,
      error: 'scheme',
    })
    expect(buildAccountUrl(withHttp({ customServices: [http], accounts: [a] }), a)).toEqual({
      ok: true,
      value: 'http://acme.example.com/',
    })
  })

  it('Gmail con una URL propia que no se puede analizar devuelve invalid', () => {
    const a = account({ serviceId: 'google.gmail', url: 'no es una url' })
    expect(buildAccountUrl(data({ accounts: [a] }), a)).toEqual({ ok: false, error: 'invalid' })
  })

  it('servicio personalizado con plantilla, y URL propia si falta un valor', () => {
    const a = account({ serviceId: 'custom:slack', username: 'acme' })
    const d = data({ customServices: [slack], accounts: [a] })
    expect(buildAccountUrl(d, a)).toEqual({ ok: true, value: 'https://acme.slack.com/' })
    const b = account({ serviceId: 'custom:slack', url: 'https://slack.com/signin' })
    expect(buildAccountUrl(data({ customServices: [slack] }), b)).toEqual({
      ok: true,
      value: 'https://slack.com/signin',
    })
  })
})

describe('serviceInfo', () => {
  it('devuelve catálogo, personalizados y undefined', () => {
    expect(serviceInfo(data(), 'claude')?.multiAccount).toBe('none')
    expect(serviceInfo(data({ customServices: [slack] }), 'custom:slack')).toEqual({
      id: 'custom:slack',
      name: 'Slack',
      multiAccount: 'parallel',
    })
    expect(serviceInfo(data(), 'custom:nada')).toBeUndefined()
  })

  it('un servicio del catálogo se devuelve sin los campos internos', () => {
    const info = serviceInfo(data(), 'google.gmail')
    expect(info).toEqual({ id: 'google.gmail', name: 'Gmail', multiAccount: 'parallel', icon: 'gmail' })
    expect(info).not.toHaveProperty('defaultUrl')
    expect(info).not.toHaveProperty('authuserHost')
    expect(info).not.toBe(CATALOG.find((s) => s.id === 'google.gmail'))
  })
})
