import { describe, expect, it } from 'vitest'
import { createTranslator, resolveLanguage } from '../../src/i18n/i18n'
import { en } from '../../src/i18n/messages.en'
import { es } from '../../src/i18n/messages.es'

describe('catálogo', () => {
  it('es y en tienen exactamente las mismas claves', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
  })

  it('ningún texto está vacío ni en blanco', () => {
    for (const catalog of [es, en]) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim(), key).not.toBe('')
      }
    }
  })
})

describe('createTranslator', () => {
  it('traduce una clave sin parámetros', () => {
    expect(createTranslator('es').t('app.title')).toBe('Account Launcher')
    expect(createTranslator('es').t('app.loading')).toBe('Cargando…')
    expect(createTranslator('en').t('app.loading')).toBe('Loading…')
  })

  it('sustituye parámetros como texto, no como HTML', () => {
    const { t } = createTranslator('es')
    expect(t('common.hello', { name: '<b>Ana</b>' })).toBe('Hola, <b>Ana</b>')
    expect(createTranslator('en').t('common.hello', { name: 'Ana' })).toBe('Hello, Ana')
  })

  it('un parámetro ausente deja el marcador tal cual', () => {
    expect(createTranslator('es').t('common.hello')).toBe('Hola, {name}')
    expect(createTranslator('es').t('common.hello', {})).toBe('Hola, {name}')
  })

  it('convierte los números en texto', () => {
    expect(createTranslator('es').t('common.items.other', { count: 3 })).toBe('3 elementos')
  })

  it('el valor sustituido no se vuelve a interpretar', () => {
    expect(createTranslator('es').t('common.hello', { name: '{name}' })).toBe('Hola, {name}')
  })

  it('tp elige singular y plural en español', () => {
    const { tp } = createTranslator('es')
    expect(tp('common.items', 1, { count: 1 })).toBe('1 elemento')
    expect(tp('common.items', 0, { count: 0 })).toBe('0 elementos')
    expect(tp('common.items', 2, { count: 2 })).toBe('2 elementos')
  })

  it('tp elige singular y plural en inglés', () => {
    const { tp } = createTranslator('en')
    expect(tp('common.items', 1, { count: 1 })).toBe('1 item')
    expect(tp('common.items', 0, { count: 0 })).toBe('0 items')
    expect(tp('common.items', 2, { count: 2 })).toBe('2 items')
  })

  it('tp con una clave inexistente usa .other y, si tampoco existe, devuelve la clave', () => {
    expect(createTranslator('es').tp('common.nope', 1)).toBe('common.nope.other')
  })
})

describe('resolveLanguage', () => {
  it('auto: español si la subetiqueta principal es es, sin distinguir mayúsculas', () => {
    expect(resolveLanguage('auto', 'es-MX')).toBe('es')
    expect(resolveLanguage('auto', 'ES')).toBe('es')
    expect(resolveLanguage('auto', 'es')).toBe('es')
  })

  it('auto: inglés para cualquier otro idioma o sin idioma', () => {
    expect(resolveLanguage('auto', 'pt-BR')).toBe('en')
    expect(resolveLanguage('auto', 'en-US')).toBe('en')
    expect(resolveLanguage('auto', 'esperanto')).toBe('en')
    expect(resolveLanguage('auto', undefined)).toBe('en')
  })

  it('un ajuste explícito manda sobre el idioma del navegador', () => {
    expect(resolveLanguage('en', 'es-ES')).toBe('en')
    expect(resolveLanguage('es', 'en-US')).toBe('es')
  })
})
