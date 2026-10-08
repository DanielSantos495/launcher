import { describe, expect, it } from 'vitest'
import { isolationWarnings, resolveTarget } from '../src/open'
import { createEmptyData, type Bindings } from '../src/schema'
import { account, data, identity } from './fixtures'

const multi = { ...createEmptyData().settings, mode: 'multi' as const }
const bindings: Bindings = {
  'id-work': { kind: 'chromium-profile', profileDirectory: 'Launcher-work0001' },
  'id-home': { kind: 'chromium-profile', profileDirectory: 'Launcher-home0001' },
}
const people = [identity(), identity({ id: 'id-home', label: 'Casa', email: 'casa@example.com' })]

describe('resolveTarget', () => {
  it('en "Perfil único" siempre abre en el perfil actual', () => {
    expect(resolveTarget({ data: data({ identities: people }), bindings }, account())).toEqual({ kind: 'current' })
  })

  it('en "Varios perfiles" abre en el perfil de la identidad', () => {
    const ctx = { data: data({ identities: people, settings: multi }), bindings }
    expect(resolveTarget(ctx, account())).toEqual({ kind: 'chromium-profile', profileDirectory: 'Launcher-work0001' })
  })

  it('respeta la excepción de la cuenta y "Abrir como…"', () => {
    const ctx = { data: data({ identities: people, settings: multi }), bindings }
    expect(resolveTarget(ctx, account({ contextOverride: 'current' }))).toEqual({ kind: 'current' })
    expect(resolveTarget(ctx, account(), 'id-home')).toEqual({
      kind: 'chromium-profile',
      profileDirectory: 'Launcher-home0001',
    })
  })

  it('sin vínculo usa el perfil actual', () => {
    const ctx = { data: data({ identities: people, settings: multi }), bindings: {} }
    expect(resolveTarget(ctx, account())).toEqual({ kind: 'current' })
  })

  it('un vínculo "current" abre en el perfil actual', () => {
    const current: Bindings = { 'id-work': { kind: 'current' } }
    const ctx = { data: data({ identities: people, settings: multi }), bindings: current }
    expect(resolveTarget(ctx, account())).toEqual({ kind: 'current' })
  })
})

describe('isolationWarnings', () => {
  const claudeWork = account({ id: 'acc-cw', serviceId: 'claude' })
  const claudeHome = account({ id: 'acc-ch', serviceId: 'claude', identityId: 'id-home' })

  it('avisa en "Perfil único" si dos cuentas de un servicio sin paralelo comparten contexto', () => {
    const ctx = { data: data({ identities: people, accounts: [claudeWork, claudeHome] }), bindings }
    expect(isolationWarnings(ctx, claudeWork).map((a) => a.id)).toEqual(['acc-ch'])
  })

  it('no avisa con perfiles distintos ni con servicios en paralelo', () => {
    const ctx = { data: data({ identities: people, accounts: [claudeWork, claudeHome], settings: multi }), bindings }
    expect(isolationWarnings(ctx, claudeWork)).toEqual([])
    const gmailA = account({ id: 'g1', serviceId: 'google.gmail' })
    const gmailB = account({ id: 'g2', serviceId: 'google.gmail', identityId: 'id-home' })
    const single = { data: data({ identities: people, accounts: [gmailA, gmailB] }), bindings }
    expect(isolationWarnings(single, gmailA)).toEqual([])
  })

  it('avisa si dos identidades comparten perfil o si ambas caen en el perfil actual', () => {
    const shared: Bindings = {
      'id-work': { kind: 'chromium-profile', profileDirectory: 'Launcher-work0001' },
      'id-home': { kind: 'chromium-profile', profileDirectory: 'Launcher-work0001' },
    }
    const ctx = {
      data: data({ identities: people, accounts: [claudeWork, claudeHome], settings: multi }),
      bindings: shared,
    }
    expect(isolationWarnings(ctx, claudeWork).map((a) => a.id)).toEqual(['acc-ch'])
    const unbound = { ...ctx, bindings: {} }
    expect(isolationWarnings(unbound, claudeWork).map((a) => a.id)).toEqual(['acc-ch'])
  })

  it('no avisa por otro servicio y un servicio desconocido se trata como sin paralelo', () => {
    const other = account({ id: 'acc-gh', identityId: 'id-home' })
    const ctx = { data: data({ identities: people, accounts: [claudeWork, other] }), bindings }
    expect(isolationWarnings(ctx, claudeWork)).toEqual([])
    const unknown = account({ id: 'acc-u1', serviceId: 'custom:desconocido' })
    const unknownB = account({ id: 'acc-u2', serviceId: 'custom:desconocido', identityId: 'id-home' })
    const ctxU = { data: data({ identities: people, accounts: [unknown, unknownB] }), bindings }
    expect(isolationWarnings(ctxU, unknown).map((a) => a.id)).toEqual(['acc-u2'])
  })
})
