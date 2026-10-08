import { err, type Result } from './result'
import type { Account, CATALOG_IDS, LauncherData } from './schema'
import { expandTemplate } from './template'
import { hasControlChars } from './text'
import { normalizeUrl, type UrlError } from './url'

export type MultiAccount = 'parallel' | 'switch' | 'none'
export type CatalogId = (typeof CATALOG_IDS)[number]

export interface CatalogService {
  readonly id: CatalogId
  readonly name: string
  readonly multiAccount: MultiAccount
  readonly icon: string
  // Sin URL por defecto, la cuenta necesita la suya (servicio genérico).
  readonly defaultUrl?: string
  // Google: se añade ?authuser=<email> a las URLs de este dominio (medido en F0).
  readonly authuserHost?: string
}

// multiAccount medido en F0 (§5.3). ChatGPT y Cloudflare, sin segunda cuenta para medir: "none" por prudencia.
export const CATALOG: readonly CatalogService[] = [
  {
    id: 'google.gmail',
    name: 'Gmail',
    multiAccount: 'parallel',
    icon: 'gmail',
    defaultUrl: 'https://mail.google.com/mail/',
    authuserHost: 'mail.google.com',
  },
  {
    id: 'google.gemini',
    name: 'Gemini',
    multiAccount: 'parallel',
    icon: 'gemini',
    defaultUrl: 'https://gemini.google.com/app',
    authuserHost: 'gemini.google.com',
  },
  { id: 'github', name: 'GitHub', multiAccount: 'switch', icon: 'github', defaultUrl: 'https://github.com/' },
  { id: 'claude', name: 'Claude', multiAccount: 'none', icon: 'claude', defaultUrl: 'https://claude.ai/' },
  { id: 'chatgpt', name: 'ChatGPT', multiAccount: 'none', icon: 'chatgpt', defaultUrl: 'https://chatgpt.com/' },
  { id: 'shopify', name: 'Shopify', multiAccount: 'none', icon: 'shopify', defaultUrl: 'https://admin.shopify.com/' },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    multiAccount: 'none',
    icon: 'cloudflare',
    defaultUrl: 'https://dash.cloudflare.com/',
  },
  { id: 'generic', name: 'Web', multiAccount: 'none', icon: 'web' },
]

export interface ServiceInfo {
  readonly id: string
  readonly name: string
  readonly multiAccount: MultiAccount
  readonly icon?: string
}

export function serviceInfo(data: LauncherData, serviceId: string): ServiceInfo | undefined {
  const known = CATALOG.find((s) => s.id === serviceId)
  // Copia solo los campos públicos: defaultUrl y authuserHost no salen del catálogo.
  if (known) return { id: known.id, name: known.name, multiAccount: known.multiAccount, icon: known.icon }
  const custom = data.customServices.find((s) => `custom:${s.id}` === serviceId)
  return custom ? { id: serviceId, name: custom.name, multiAccount: custom.multiAccount } : undefined
}

export type BuildError = 'no_url' | UrlError

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+$/

function withAuthuser(base: string, host: string, email: string): string {
  // new URL() elimina tabuladores y saltos de línea sin avisar: normalizeUrl debe verlos y rechazarlos.
  if (hasControlChars(base)) return base
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return base
  }
  if (url.hostname !== host) return base
  url.searchParams.set('authuser', email)
  return url.href
}

function primaryUrl(data: LauncherData, account: Account, email: string | undefined): string | undefined {
  if (account.serviceId.startsWith('custom:')) {
    const custom = data.customServices.find((s) => `custom:${s.id}` === account.serviceId)
    return custom ? expandTemplate(custom.urlTemplate, { email, username: account.username }) : undefined
  }
  const service = CATALOG.find((s) => s.id === account.serviceId)
  const base = account.url ?? service?.defaultUrl
  if (base === undefined || service?.authuserHost === undefined || email === undefined) return base
  return withAuthuser(base, service.authuserHost, email)
}

// buildAccountUrl calcula la URL que se abre. Prueba primero la del servicio y luego la URL propia de la cuenta;
// la primera que supera normalizeUrl gana (§5.3: si un builder falla, se usa el genérico).
export function buildAccountUrl(data: LauncherData, account: Account): Result<string, BuildError> {
  const policy = { allowHttp: data.settings.allowHttp }
  const identity = data.identities.find((i) => i.id === account.identityId)
  const email = account.username !== undefined && EMAIL_LIKE.test(account.username) ? account.username : identity?.email
  const candidates = [primaryUrl(data, account, email), account.url].filter((u): u is string => u !== undefined)
  let last: BuildError = 'no_url'
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate, policy)
    if (normalized.ok) return normalized
    last = normalized.error
  }
  return err(last)
}
