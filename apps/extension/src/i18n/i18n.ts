import { en } from './messages.en'
import { es } from './messages.es'

export type Language = 'es' | 'en'
export type MessageKey = keyof typeof es

type Params = Readonly<Record<string, string | number>>

const CATALOGS: Readonly<Record<Language, Readonly<Record<string, string>>>> = { es, en }

// 'auto' sigue el idioma del navegador: español si la subetiqueta principal es "es"; en cualquier otro caso, inglés.
export function resolveLanguage(setting: 'auto' | Language, navigatorLanguage: string | undefined): Language {
  if (setting !== 'auto') return setting
  return navigatorLanguage?.split('-')[0]?.toLowerCase() === 'es' ? 'es' : 'en'
}

// Sustituye {nombre} por el valor recibido, en una sola pasada (el valor no se vuelve a interpretar) y como
// texto: quien lo pinte debe hacerlo con React o textContent, nunca como HTML.
function interpolate(template: string, params: Params | undefined): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (marker, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : marker,
  )
}

// Fábrica interna sobre un catálogo cualquiera (las pruebas le pasan catálogos con claves sueltas). La interfaz
// pública es createTranslator(language).
export function makeTranslator(catalog: Readonly<Record<string, string>>, language: Language) {
  const lookup = (key: string): string | undefined => (Object.hasOwn(catalog, key) ? catalog[key] : undefined)
  const plural = new Intl.PluralRules(language)

  // Funciones (no métodos) para poder desestructurar: const { t } = createTranslator(language).
  return {
    t: (key: MessageKey, params?: Params): string => interpolate(lookup(key) ?? key, params),
    // Plurales: elige `${baseKey}.one` u `${baseKey}.other` según las reglas del idioma. Si falta la clave
    // `.one`, usa `.other`; si tampoco existe, devuelve la clave.
    tp: (baseKey: string, count: number, params?: Params): string => {
      const otherKey = `${baseKey}.other`
      const key = plural.select(count) === 'one' ? `${baseKey}.one` : otherKey
      return interpolate(lookup(key) ?? lookup(otherKey) ?? otherKey, params)
    },
  }
}

export function createTranslator(language: Language) {
  return makeTranslator(CATALOGS[language], language)
}

export type Translator = ReturnType<typeof createTranslator>
