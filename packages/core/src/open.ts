import type { Account, Bindings, LauncherData } from './schema'
import { serviceInfo } from './services'

export type OpenTarget =
  { readonly kind: 'current' } | { readonly kind: 'chromium-profile'; readonly profileDirectory: string }

export interface OpenContext {
  readonly data: LauncherData
  readonly bindings: Bindings
}

const CURRENT: OpenTarget = { kind: 'current' }

// resolveTarget decide dónde se abre una cuenta (§1, §5.2). En "Perfil único" se ignoran los vínculos.
export function resolveTarget(ctx: OpenContext, account: Account, asIdentityId?: string): OpenTarget {
  if (ctx.data.settings.mode === 'single' || account.contextOverride === 'current') return CURRENT
  const binding = ctx.bindings[asIdentityId ?? account.identityId]
  return binding?.kind === 'chromium-profile'
    ? { kind: 'chromium-profile', profileDirectory: binding.profileDirectory }
    : CURRENT
}

function sameTarget(a: OpenTarget, b: OpenTarget): boolean {
  if (a.kind === 'current' || b.kind === 'current') return a.kind === b.kind
  return a.profileDirectory === b.profileDirectory
}

// isolationWarnings devuelve las otras cuentas del mismo servicio que acabarían en el mismo contexto
// cuando el servicio no admite cuentas en paralelo (criterio de F1: la UI avisa).
export function isolationWarnings(ctx: OpenContext, account: Account): Account[] {
  if (serviceInfo(ctx.data, account.serviceId)?.multiAccount === 'parallel') return []
  const target = resolveTarget(ctx, account)
  return ctx.data.accounts.filter(
    (other) =>
      other.id !== account.id && other.serviceId === account.serviceId && sameTarget(resolveTarget(ctx, other), target),
  )
}
