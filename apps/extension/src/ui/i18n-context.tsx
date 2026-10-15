import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { createTranslator, type Language, type Translator } from '../i18n/i18n'

export interface I18n {
  readonly language: Language
  readonly t: Translator['t']
  readonly tp: Translator['tp']
}

const I18nContext = createContext<I18n | undefined>(undefined)

// Traductor del idioma indicado para todo el árbol. Los textos se pintan siempre como texto de React, nunca como HTML.
export function I18nProvider({ language, children }: { readonly language: Language; readonly children: ReactNode }) {
  const value = useMemo<I18n>(() => ({ language, ...createTranslator(language) }), [language])
  return <I18nContext value={value}>{children}</I18nContext>
}

export function useI18n(): I18n {
  const value = useContext(I18nContext)
  if (value === undefined) throw new Error('useI18n necesita un I18nProvider')
  return value
}
