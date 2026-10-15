import { HOST_ERROR_CODES, UI_ERROR_CODES, type UiErrorCode } from '@account-launcher/protocol'
import { describe, expect, it } from 'vitest'
import { HINTS } from '../../src/background/hints'
import { createTranslator, type Language } from '../../src/i18n/i18n'
import { errorText } from '../../src/ui/lib/errors'

const LANGUAGES: readonly Language[] = ['es', 'en']
const CODES: readonly UiErrorCode[] = [...new Set<UiErrorCode>([...UI_ERROR_CODES, ...HOST_ERROR_CODES])]

describe('errorText', () => {
  it.each(LANGUAGES)('cada código tiene título propio en %s', (language) => {
    const { t } = createTranslator(language)
    const titles = new Set<string>()
    for (const code of CODES) {
      const { title, detail } = errorText({ code }, t)
      expect(title, code).not.toBe('')
      expect(title, code).not.toBe(`error.${code}`)
      expect(detail, code).toBeUndefined()
      titles.add(title)
    }
    // Cada código tiene su propio texto: no se reutiliza uno genérico.
    expect(titles.size).toBe(CODES.length)
  })

  it.each(LANGUAGES)('cada pista tiene su texto en %s', (language) => {
    const { t } = createTranslator(language)
    const details = new Set<string>()
    for (const hint of HINTS) {
      const { title, detail } = errorText({ code: 'invalid', hint }, t)
      expect(title).toBe(t('error.invalid'))
      expect(detail, hint).toBeDefined()
      expect(detail, hint).not.toBe('')
      expect(detail, hint).not.toBe(`hint.${hint}`)
      details.add(detail ?? '')
    }
    expect(details.size).toBe(HINTS.length)
  })

  it('una pista desconocida se ignora y no se muestra', () => {
    const { t } = createTranslator('es')
    expect(errorText({ code: 'invalid', hint: 'maria@example.com' }, t)).toEqual({ title: t('error.invalid') })
  })

  it('un código desconocido cae en el error interno', () => {
    const { t } = createTranslator('es')
    expect(errorText({ code: 'nada' }, t)).toEqual({ title: t('error.internal') })
  })

  it('el texto de host_missing explica cómo arreglarlo', () => {
    const { t } = createTranslator('es')
    expect(errorText({ code: 'host_missing' }, t).title).toContain('Perfil único')
  })
})
