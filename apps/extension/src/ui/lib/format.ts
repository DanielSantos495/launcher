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

// "491,5 KB": kibibytes con los decimales indicados y el separador del idioma. Un KB son 1024 bytes, como en el límite
// del almacén compartido.
export function formatKb(language: Language, bytes: number, fractionDigits: number): string {
  const number = new Intl.NumberFormat(language, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(bytes / 1024)
  return `${number} KB`
}

// "1:59": minutos y segundos de una cuenta atrás. Los segundos negativos cuentan como cero.
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.trunc(totalSeconds))
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
}

// Fecha y hora cortas en el idioma de la interfaz y la zona horaria del navegador. Una marca no válida da texto vacío.
export function formatDateTime(language: Language, iso: string): string {
  const time = Date.parse(iso)
  return Number.isNaN(time)
    ? ''
    : new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time))
}
