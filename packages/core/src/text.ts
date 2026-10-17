import * as v from 'valibot'

// Caracteres de control C0, DEL y C1: nunca son válidos en nombres, URLs ni carpetas (T2).
// `allowed` permite excepciones concretas, como el salto de línea en las notas.
export function hasControlChars(s: string, allowed = ''): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if ((c < 0x20 || (c >= 0x7f && c <= 0x9f)) && !allowed.includes(ch)) return true
  }
  return false
}

// \p{Cs} con la bandera `u` solo casa un sustituto UTF-16 suelto: un par válido es un único punto de código (no es Cs).
const LONE_SURROGATE = /\p{Cs}/u

// Un sustituto suelto (U+D800 a U+DFFF sin su pareja) se escribe en JSON como "\ud800" y el host en Go rechaza ese
// JSON (bad_request, ADR-004 punto 10): la sincronización fallaría para siempre. Todo texto del modelo debe estar bien
// formado. No se usa String.prototype.isWellFormed porque la lib del proyecto es ES2023.
export function isWellFormed(s: string): boolean {
  return !LONE_SURROGATE.test(s)
}

// Acción de esquema compartida: rechaza un texto con sustitutos sueltos con un mismo mensaje en todo el modelo.
export const wellFormed = v.check(isWellFormed, 'texto mal formado')
