import type { Language } from '../../i18n/i18n'

const listFormats = new Map<Language, Intl.ListFormat>()

// "A, B y C" (o "A, B, and C") según el idioma. El formato se crea una vez por idioma.
export function formatList(language: Language, items: readonly string[]): string {
  let format = listFormats.get(language)
  if (format === undefined) {
    format = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' })
    listFormats.set(language, format)
  }
  return format.format(items)
}
