import { createEmptyData } from '@account-launcher/core'
import { UiRequestSchema, type UiRequestType } from '@account-launcher/protocol'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { HINTS } from '../../src/background/hints'
import { createTestEnv } from '../helpers/env'
import { pngImage } from '../helpers/images'

// Un mensaje mínimo válido por cada tipo: añadir un tipo a UiRequestSchema sin añadirlo aquí no compila.
const MESSAGES: { readonly [K in UiRequestType]: unknown } = {
  'account.open': { type: 'account.open', accountId: 'a1' },
  'account.openTemporary': { type: 'account.openTemporary', target: { kind: 'account', accountId: 'a1' } },
  'capabilities.get': { type: 'capabilities.get' },
  'profiles.list': { type: 'profiles.list' },
  'profiles.create': { type: 'profiles.create', identityId: 'i1', name: 'Trabajo' },
  'host.ping': { type: 'host.ping' },
  'data.get': { type: 'data.get' },
  'data.mutate': { type: 'data.mutate', revision: 0, ops: [{ type: 'settings.set', settings: { theme: 'dark' } }] },
  'data.import': { type: 'data.import', revision: 0, mode: 'merge', data: createEmptyData() },
  'bindings.get': { type: 'bindings.get' },
  'bindings.set': { type: 'bindings.set', identityId: 'i1', binding: null },
  'pair.start': { type: 'pair.start' },
  'pair.join': { type: 'pair.join', code: '123456' },
  'pair.declare': { type: 'pair.declare', profileDirectory: 'Default' },
  'pair.list': { type: 'pair.list' },
  'pair.remove': { type: 'pair.remove', installationId: 'inst-b' },
  'pair.verify': { type: 'pair.verify' },
  'sync.refresh': { type: 'sync.refresh' },
  'icon.get': { type: 'icon.get', key: 'icon:img-1' },
  'icon.put': { type: 'icon.put', key: 'icon:img-1', ...pngImage() },
  'icon.delete': { type: 'icon.delete', key: 'icon:img-1' },
}

// Pista provisional que ya no existe. Se arma por partes para que buscarla en el código solo encuentre código vivo.
const REMOVED_HINT = ['not', 'implemented'].join('_')

describe('router completo', () => {
  it('HINTS ya no contiene la pista provisional', () => {
    const hints: readonly string[] = HINTS
    expect(hints).not.toContain(REMOVED_HINT)
  })

  it.each(Object.entries(MESSAGES))(
    '%s tiene manejador (nunca la pista provisional) en una instalación nueva',
    async (_type, message) => {
      // El mensaje de prueba es válido para el esquema: un rechazo del router no cuenta como manejador.
      expect(v.safeParse(UiRequestSchema, message).success).toBe(true)
      const t = createTestEnv()
      const response = await t.route(message)
      expect(response.ok ? undefined : response.error.hint).not.toBe(REMOVED_HINT)
      expect(response.ok ? undefined : response.error).not.toEqual({ code: 'invalid' })
    },
  )
})
