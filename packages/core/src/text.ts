// Caracteres de control C0, DEL y C1: nunca son válidos en nombres, URLs ni carpetas (T2).
// `allowed` permite excepciones concretas, como el salto de línea en las notas.
export function hasControlChars(s: string, allowed = ''): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if ((c < 0x20 || (c >= 0x7f && c <= 0x9f)) && !allowed.includes(ch)) return true
  }
  return false
}
