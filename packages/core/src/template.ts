import { normalizeUrl, type UrlPolicy } from './url'

// Marcadores admitidos en las plantillas de servicios personalizados (§5.3).
const PLACEHOLDER = /\{(email|username)\}/g
const BRACE = /[{}]/

export interface TemplateValues {
  readonly email?: string | undefined
  readonly username?: string | undefined
}

// expandTemplate sustituye los marcadores con valores codificados (encodeURIComponent).
// Devuelve undefined si falta algún valor o no se puede codificar (encodeURIComponent lanza URIError con
// sustitutos sueltos, p. ej. '\ud800'): la cuenta usará entonces su URL propia.
export function expandTemplate(template: string, values: TemplateValues): string | undefined {
  const missing: string[] = []
  try {
    const out = template.replace(PLACEHOLDER, (_match: string, key: string) => {
      const value = key === 'email' ? values.email : values.username
      if (value === undefined || value === '') {
        missing.push(key)
        return ''
      }
      return encodeURIComponent(value)
    })
    return missing.length > 0 ? undefined : out
  } catch {
    return undefined
  }
}

// isValidTemplate exige que solo haya marcadores conocidos y que el resultado sea una URL abrible.
export function isValidTemplate(template: string, policy: UrlPolicy): boolean {
  if (BRACE.test(template.replace(PLACEHOLDER, ''))) return false
  const sample = expandTemplate(template, { email: 'user@example.com', username: 'user' })
  return sample !== undefined && normalizeUrl(sample, policy).ok
}
