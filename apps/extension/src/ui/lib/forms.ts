import {
  AccountSchema,
  CustomServiceSchema,
  err,
  GroupSchema,
  IdentitySchema,
  isValidTemplate,
  normalizeUrl,
  ok,
  type Account,
  type CustomService,
  type Group,
  type IconRef,
  type Identity,
  type LauncherData,
  type Result,
  type UrlError,
} from '@account-launcher/core'
import * as v from 'valibot'
import type { MessageKey } from '../../i18n/i18n'

// Errores por campo: la clave del campo del formulario y la clave de traducción del mensaje. Nunca llevan datos.
export type FieldErrors = Readonly<Record<string, MessageKey>>

export interface BuildContext {
  readonly now: Date
  readonly newId: () => string
  readonly data: LauncherData
}

// Los campos del formulario son texto (o un booleano): los builders los convierten en la entidad completa.
export interface IdentityInput {
  readonly label: string
  readonly email: string
  readonly color: string
}

export interface GroupInput {
  readonly name: string
  readonly color: string
  readonly icon: string // emoji; vacío = sin icono
}

export interface AccountInput {
  readonly label: string
  readonly url: string
  readonly username: string
  readonly notes: string
  readonly serviceId: string
  readonly identityId: string
  readonly groupId: string // vacío = sin grupo
  readonly icon: string // emoji; vacío = el del servicio
  readonly favorite: boolean
  readonly contextOverride: string // '', 'identity' o 'current'
}

export interface CustomServiceInput {
  readonly name: string
  readonly urlTemplate: string
  readonly multiAccount: string
}

// Contexto de construcción con el instante dado (el reloj de la interfaz) y el generador de ids reales.
export function buildContext(data: LauncherData, now: Date): BuildContext {
  return { now, newId: () => crypto.randomUUID(), data }
}

const MAX_ORDER = 1_000_000

// Colores sugeridos para las identidades y los grupos nuevos: cada una empieza con uno distinto.
const PALETTE = ['#2f6fdb', '#d4572a', '#2a9d6f', '#8a4fd1', '#b8801f', '#cc3f77', '#2b8aa3', '#5b6b7c'] as const

export function defaultColor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? '#2f6fdb'
}

// Siguiente posición al final de la lista: el máximo más uno (0 si está vacía), con el tope de OrderSchema.
export function nextOrder(items: readonly { readonly order: number }[]): number {
  let max = -1
  for (const item of items) if (item.order > max) max = item.order
  return Math.min(max + 1, MAX_ORDER)
}

// Mensaje de un problema del esquema de core según el campo. Solo mira el tipo de regla y si el texto estaba en blanco:
// nunca copia el valor.
function issueKey(field: string, issue: v.BaseIssue<unknown>): MessageKey {
  if (field === 'email') return 'field.email.invalid'
  if (field === 'icon') return 'field.emoji.invalid'
  if (field === 'color') return 'field.color.invalid'
  if (typeof issue.input === 'string' && issue.input.trim() === '') return 'field.required'
  switch (field) {
    case 'label':
    case 'name':
    case 'username':
    case 'notes':
      return issue.type === 'max_length' ? 'field.too_long' : 'field.invalid_text'
    default:
      return 'field.invalid'
  }
}

// Reúne los errores de campo: el primero de cada campo gana (los problemas del esquema llegan en el orden del pipe).
class ErrorCollector {
  private readonly errors = new Map<string, MessageKey>()

  add(field: string, key: MessageKey): void {
    if (!this.errors.has(field)) this.errors.set(field, key)
  }

  addIssues(issues: readonly v.BaseIssue<unknown>[]): void {
    for (const issue of issues) {
      const field = issue.path?.[0]?.key
      const name = typeof field === 'string' ? field : 'form'
      this.add(name, issueKey(name, issue))
    }
  }

  get any(): boolean {
    return this.errors.size > 0
  }

  toRecord(): FieldErrors {
    return Object.fromEntries(this.errors)
  }
}

// Valida con el esquema de core y devuelve la entidad o los errores acumulados (los previos incluidos).
function finish<T>(
  collector: ErrorCollector,
  schema: v.GenericSchema<unknown, T>,
  candidate: unknown,
): Result<T, FieldErrors> {
  const parsed = v.safeParse(schema, candidate)
  if (!parsed.success) collector.addIssues(parsed.issues)
  return parsed.success && !collector.any ? ok(parsed.output) : err(collector.toRecord())
}

// Emoji opcional: vacío = sin icono. El esquema de core acota la longitud (16 unidades UTF-16) y los controles.
function emojiRef(raw: string): IconRef | undefined {
  const value = raw.trim()
  return value === '' ? undefined : { type: 'emoji', value }
}

export function buildIdentity(
  input: IdentityInput,
  ctx: BuildContext,
  existing?: Identity,
): Result<Identity, FieldErrors> {
  const now = ctx.now.toISOString()
  const email = input.email.trim()
  const candidate = {
    id: existing?.id ?? ctx.newId(),
    label: input.label.trim(),
    ...(email === '' ? {} : { email }),
    color: input.color,
    ...(existing?.avatar === undefined ? {} : { avatar: existing.avatar }),
    order: existing?.order ?? nextOrder(ctx.data.identities),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  return finish(new ErrorCollector(), IdentitySchema, candidate)
}

export function buildGroup(input: GroupInput, ctx: BuildContext, existing?: Group): Result<Group, FieldErrors> {
  const now = ctx.now.toISOString()
  const icon = emojiRef(input.icon)
  const candidate = {
    id: existing?.id ?? ctx.newId(),
    name: input.name.trim(),
    color: input.color,
    ...(icon === undefined ? {} : { icon }),
    order: existing?.order ?? nextOrder(ctx.data.groups),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  return finish(new ErrorCollector(), GroupSchema, candidate)
}

export function buildAccount(input: AccountInput, ctx: BuildContext, existing?: Account): Result<Account, FieldErrors> {
  const now = ctx.now.toISOString()
  const collector = new ErrorCollector()
  // La URL propia se guarda normalizada (con la política http de los ajustes); sin ella, el servicio genérico no abre.
  const rawUrl = input.url.trim()
  let url: string | undefined
  if (rawUrl !== '') {
    const normalized = normalizeUrl(rawUrl, { allowHttp: ctx.data.settings.allowHttp })
    if (normalized.ok) url = normalized.value
    else collector.add('url', urlErrorKey(normalized.error))
  } else if (input.serviceId === 'generic') {
    collector.add('url', 'field.url.required')
  }
  const username = input.username.trim()
  const icon = emojiRef(input.icon)
  const candidate = {
    id: existing?.id ?? ctx.newId(),
    identityId: input.identityId,
    groupId: input.groupId === '' ? null : input.groupId,
    serviceId: input.serviceId,
    label: input.label.trim(),
    ...(url === undefined ? {} : { url }),
    ...(username === '' ? {} : { username }),
    // Las notas conservan sus saltos de línea; solo se omiten si son solo espacios.
    ...(input.notes.trim() === '' ? {} : { notes: input.notes }),
    icon: icon ?? { type: 'auto' },
    favorite: input.favorite,
    ...(input.contextOverride === '' ? {} : { contextOverride: input.contextOverride }),
    order: existing?.order ?? nextOrder(ctx.data.accounts),
    ...(existing?.lastOpenedAt === undefined ? {} : { lastOpenedAt: existing.lastOpenedAt }),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  return finish(collector, AccountSchema, candidate)
}

export function buildCustomService(
  input: CustomServiceInput,
  ctx: BuildContext,
  existing?: CustomService,
): Result<CustomService, FieldErrors> {
  const now = ctx.now.toISOString()
  const collector = new ErrorCollector()
  const urlTemplate = input.urlTemplate.trim()
  if (urlTemplate === '') collector.add('urlTemplate', 'field.required')
  else if (!isValidTemplate(urlTemplate, { allowHttp: ctx.data.settings.allowHttp })) {
    collector.add('urlTemplate', 'field.template.invalid')
  }
  const candidate = {
    id: existing?.id ?? ctx.newId(),
    name: input.name.trim(),
    urlTemplate,
    multiAccount: input.multiAccount,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  return finish(collector, CustomServiceSchema, candidate)
}

const URL_ERROR_KEYS: Readonly<Record<UrlError, MessageKey>> = {
  invalid: 'field.url.invalid',
  scheme: 'field.url.scheme',
  host: 'field.url.host',
  userinfo: 'field.url.userinfo',
  length: 'field.url.length',
  chars: 'field.url.chars',
}

function urlErrorKey(error: UrlError): MessageKey {
  return URL_ERROR_KEYS[error]
}

// Valores iniciales de los formularios de edición.
export function identityToInput(identity: Identity): IdentityInput {
  return { label: identity.label, email: identity.email ?? '', color: identity.color }
}

export function groupToInput(group: Group): GroupInput {
  return { name: group.name, color: group.color, icon: group.icon?.type === 'emoji' ? group.icon.value : '' }
}

export function accountToInput(account: Account): AccountInput {
  return {
    label: account.label,
    url: account.url ?? '',
    username: account.username ?? '',
    notes: account.notes ?? '',
    serviceId: account.serviceId,
    identityId: account.identityId,
    groupId: account.groupId ?? '',
    icon: account.icon.type === 'emoji' ? account.icon.value : '',
    favorite: account.favorite,
    contextOverride: account.contextOverride ?? '',
  }
}

export function customServiceToInput(service: CustomService): CustomServiceInput {
  return { name: service.name, urlTemplate: service.urlTemplate, multiAccount: service.multiAccount }
}
