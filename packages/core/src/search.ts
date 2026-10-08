import { compareId, compareText } from './compare'
import type { Account, LauncherData } from './schema'
import { serviceInfo } from './services'

export interface SearchHit {
  readonly account: Account
  readonly score: number
}

export interface SearchOptions {
  readonly limit?: number
  readonly now?: Date
}

const RECENT_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_LIMIT = 50
// Una consulta enorme no debe bloquear la paleta: se acota el texto y el número de términos distintos.
const MAX_QUERY_CHARS = 200
const MAX_TERMS = 8

export function normalizeText(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

// Puntuación de un término en un campo. Sin expresiones regulares construidas con la consulta:
// los caracteres especiales se comparan como texto (Review Focus 5).
function scoreTerm(term: string, field: string): number {
  if (field === term) return 100
  if (field.startsWith(term)) return 70
  if (field.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(term))) return 60
  if (field.includes(term)) return 40
  if (term.length >= 2 && isSubsequence(term, field)) return 10
  return 0
}

// Términos de la consulta: normalizados, sin repetidos y como mucho los MAX_TERMS primeros.
function queryTerms(query: string): string[] {
  const words = normalizeText(query).slice(0, MAX_QUERY_CHARS).split(/\s+/)
  return [...new Set(words.filter((t) => t !== ''))].slice(0, MAX_TERMS)
}

// Límite no finito (NaN, Infinity) = valor por defecto; negativo = 0; los decimales se truncan.
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(0, Math.trunc(limit))
}

function isSubsequence(term: string, field: string): boolean {
  let i = 0
  for (const ch of field) {
    if (ch === term[i]) i++
    if (i === term.length) return true
  }
  return false
}

// searchAccounts: todas las palabras de la consulta deben coincidir en algún campo (criterio de F1: nombre,
// servicio, email y username). Favoritas y abiertas en los últimos 7 días reciben un pequeño impulso.
export function searchAccounts(data: LauncherData, query: string, options: SearchOptions = {}): SearchHit[] {
  const terms = queryTerms(query)
  const now = (options.now ?? new Date()).getTime()
  const hits: SearchHit[] = []
  for (const account of data.accounts) {
    const identity = data.identities.find((i) => i.id === account.identityId)
    const fields: [string, number][] = [
      [account.label, 1],
      [serviceInfo(data, account.serviceId)?.name ?? '', 0.8],
      [account.username ?? '', 0.7],
      [identity?.email ?? '', 0.6],
      [identity?.label ?? '', 0.5],
    ]
    const normalized = fields.map(([text, weight]) => [normalizeText(text), weight] as const)
    let score = 0
    let matchedAll = true
    for (const term of terms) {
      const best = Math.max(...normalized.map(([text, weight]) => scoreTerm(term, text) * weight))
      if (best === 0) {
        matchedAll = false
        break
      }
      score += best
    }
    if (!matchedAll) continue
    if (account.favorite) score += 5
    if (account.lastOpenedAt !== undefined) {
      // Una marca futura (0 > edad) no cuenta como reciente.
      const age = now - Date.parse(account.lastOpenedAt)
      if (age >= 0 && age <= RECENT_MS) score += 3
    }
    hits.push({ account, score })
  }
  hits.sort(
    (a, b) =>
      b.score - a.score || compareText(a.account.label, b.account.label) || compareId(a.account.id, b.account.id),
  )
  return hits.slice(0, clampLimit(options.limit))
}
