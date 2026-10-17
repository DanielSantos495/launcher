import * as v from 'valibot'
import { err, ok, type Result } from './result'
import {
  AccountSchema,
  boundedArray,
  CustomServiceSchema,
  GroupSchema,
  IdentitySchema,
  IdSchema,
  LIMITS,
  notArray,
  parseLauncherData,
  SettingsSchema,
  TimestampSchema,
  type LauncherData,
  type Settings,
} from './schema'

// Operaciones de escritura. El SW es el único escritor (§5.4): aplica operaciones, no reemplaza los datos,
// y así puede reaplicarlas si otra instalación escribió antes (conflicto de revisión, §4.5).
export const OpSchema = v.variant('type', [
  v.strictObject({ type: v.literal('identity.put'), identity: IdentitySchema }),
  v.strictObject({ type: v.literal('identity.delete'), id: IdSchema }),
  v.strictObject({ type: v.literal('group.put'), group: GroupSchema }),
  v.strictObject({ type: v.literal('group.delete'), id: IdSchema }),
  v.strictObject({ type: v.literal('account.put'), account: AccountSchema }),
  v.strictObject({ type: v.literal('account.delete'), id: IdSchema }),
  v.strictObject({ type: v.literal('account.touch'), id: IdSchema, at: TimestampSchema }),
  // Reordenar: reparte entre los ids de la lista, en ese orden, los valores de `order` que ya tenían (o, si hay
  // empates, el índice 0, 1, 2…). Las entidades que no están en la lista no cambian. Un id repetido da `invalid`; uno inexistente, `not_found`.
  v.strictObject({ type: v.literal('identity.reorder'), ids: boundedArray(IdSchema, LIMITS.identities) }),
  v.strictObject({ type: v.literal('account.reorder'), ids: boundedArray(IdSchema, LIMITS.accounts) }),
  v.strictObject({ type: v.literal('customService.put'), service: CustomServiceSchema }),
  v.strictObject({ type: v.literal('customService.delete'), id: IdSchema }),
  v.strictObject({
    type: v.literal('settings.set'),
    settings: v.pipe(v.unknown(), notArray, v.partial(SettingsSchema)),
  }),
])

export type Op = v.InferOutput<typeof OpSchema>

export interface OpError {
  readonly code: 'not_found' | 'in_use' | 'invalid'
  // Índice de la operación. Con not_found e in_use es la que falló. Con invalid es siempre la última del lote: el
  // resultado se valida entero al final y no se sabe qué operación lo dejó inválido (la UI no debe señalar una).
  readonly op: number
  readonly issues?: string[]
}

type StepError = Omit<OpError, 'op'>

function upsert<T extends { readonly id: string }>(list: readonly T[], item: T): T[] {
  const index = list.findIndex((x) => x.id === item.id)
  return index === -1 ? [...list, item] : list.map((x, i) => (i === index ? item : x))
}

// Mezcla los ajustes indicados sobre los actuales; una clave ausente o undefined conserva el valor actual.
// Se escribe campo a campo: si Settings gana un campo, tsc obliga a añadirlo aquí (sin conversiones de tipo).
function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  return {
    mode: patch.mode ?? current.mode,
    language: patch.language ?? current.language,
    defaultView: patch.defaultView ?? current.defaultView,
    theme: patch.theme ?? current.theme,
    allowHttp: patch.allowHttp ?? current.allowHttp,
  }
}

// Asigna order = posición en `ids` a las entidades indicadas. not_found si falta alguna; invalid si hay repetidas.
function reorder<T extends { readonly id: string; readonly order: number }>(
  list: readonly T[],
  ids: readonly string[],
): Result<T[], StepError> {
  const position = new Map<string, number>()
  for (const [index, id] of ids.entries()) {
    if (position.has(id)) return err({ code: 'invalid' })
    position.set(id, index)
  }
  const known = new Set(list.map((item) => item.id))
  if (ids.some((id) => !known.has(id))) return err({ code: 'not_found' })
  // Se reparten entre los ids, en el nuevo orden, los valores de `order` que ya tenían: así el orden global entre
  // secciones (otra identidad, otro grupo) no se altera. Con empates entre ellos se usa el índice de la lista.
  const taken = list.filter((item) => position.has(item.id)).map((item) => item.order)
  taken.sort((a, b) => a - b)
  const distinct = taken.every((value, index) => index === 0 || value !== taken[index - 1])
  return ok(
    list.map((item) => {
      const index = position.get(item.id)
      if (index === undefined) return item
      return { ...item, order: distinct ? (taken[index] ?? index) : index }
    }),
  )
}

function applyOp(d: LauncherData, op: Op): Result<LauncherData, StepError> {
  switch (op.type) {
    case 'identity.put':
      return ok({ ...d, identities: upsert(d.identities, op.identity) })
    case 'identity.delete':
      if (!d.identities.some((i) => i.id === op.id)) return err({ code: 'not_found' })
      if (d.accounts.some((a) => a.identityId === op.id)) return err({ code: 'in_use' })
      return ok({ ...d, identities: d.identities.filter((i) => i.id !== op.id) })
    case 'group.put':
      return ok({ ...d, groups: upsert(d.groups, op.group) })
    case 'group.delete':
      if (!d.groups.some((g) => g.id === op.id)) return err({ code: 'not_found' })
      return ok({
        ...d,
        groups: d.groups.filter((g) => g.id !== op.id),
        accounts: d.accounts.map((a) => (a.groupId === op.id ? { ...a, groupId: null } : a)),
      })
    case 'account.put':
      return ok({ ...d, accounts: upsert(d.accounts, op.account) })
    case 'account.delete':
      if (!d.accounts.some((a) => a.id === op.id)) return err({ code: 'not_found' })
      return ok({ ...d, accounts: d.accounts.filter((a) => a.id !== op.id) })
    case 'account.touch':
      if (!d.accounts.some((a) => a.id === op.id)) return err({ code: 'not_found' })
      return ok({ ...d, accounts: d.accounts.map((a) => (a.id === op.id ? { ...a, lastOpenedAt: op.at } : a)) })
    case 'identity.reorder': {
      const identities = reorder(d.identities, op.ids)
      return identities.ok ? ok({ ...d, identities: identities.value }) : identities
    }
    case 'account.reorder': {
      const accounts = reorder(d.accounts, op.ids)
      return accounts.ok ? ok({ ...d, accounts: accounts.value }) : accounts
    }
    case 'customService.put':
      return ok({ ...d, customServices: upsert(d.customServices, op.service) })
    case 'customService.delete':
      if (!d.customServices.some((s) => s.id === op.id)) return err({ code: 'not_found' })
      if (d.accounts.some((a) => a.serviceId === `custom:${op.id}`)) return err({ code: 'in_use' })
      return ok({ ...d, customServices: d.customServices.filter((s) => s.id !== op.id) })
    case 'settings.set':
      return ok({ ...d, settings: mergeSettings(d.settings, op.settings) })
  }
}

// applyOps aplica las operaciones en orden sobre una copia y valida el resultado con el esquema completo.
export function applyOps(data: LauncherData, ops: readonly Op[]): Result<LauncherData, OpError> {
  if (ops.length === 0) return ok(data)
  let next = data
  for (const [index, op] of ops.entries()) {
    const step = applyOp(next, op)
    if (!step.ok) return err({ ...step.error, op: index })
    next = step.value
  }
  // El resultado debe ser siempre un dato persistible: esquema completo, límites y reglas entre campos.
  const valid = parseLauncherData({ ...next, revision: data.revision + 1 })
  if (!valid.ok) return err({ code: 'invalid', op: ops.length - 1, issues: valid.error })
  return ok(valid.value)
}
