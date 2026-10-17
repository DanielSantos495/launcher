import { describe, expect, it } from 'vitest'
import { backupSize, isRelevantChange, parseInstallation, toUiResponse } from '../../src/ui/client'

describe('toUiResponse', () => {
  it('deja pasar una respuesta correcta con su resultado', () => {
    expect(
      toUiResponse<{ type: 'data.mutate'; revision: number; ops: [] }>({ ok: true, result: { revision: 3 } }),
    ).toEqual({
      ok: true,
      result: { revision: 3 },
    })
  })

  it('deja pasar un error con código y pista', () => {
    expect(toUiResponse({ ok: false, error: { code: 'host_missing', hint: 'host_failed' } })).toEqual({
      ok: false,
      error: { code: 'host_missing', hint: 'host_failed' },
    })
  })

  it.each([
    ['undefined', undefined],
    ['un texto', 'hola'],
    ['sin resultado', { ok: true }],
    ['con campos de más', { ok: true, result: {}, extra: 1 }],
    ['un código desconocido', { ok: false, error: { code: 'maria@example.com' } }],
    ['un error sin código', { ok: false, error: {} }],
    ['una pista que no es texto', { ok: false, error: { code: 'invalid', hint: 7 } }],
    ['ok no booleano', { ok: 'sí', result: {} }],
  ])('un sobre mal formado (%s) es internal', (_name, raw) => {
    expect(toUiResponse(raw)).toEqual({ ok: false, error: { code: 'internal' } })
  })
})

describe('parseInstallation', () => {
  it('lee una instalación válida con sus campos opcionales', () => {
    expect(
      parseInstallation({
        installationId: 'inst-1',
        paired: true,
        ownIdentityId: 'ana',
        ownProfileDirectory: 'Default',
      }),
    ).toEqual({ installationId: 'inst-1', paired: true, ownIdentityId: 'ana', ownProfileDirectory: 'Default' })
  })

  it.each([
    ['nada', undefined],
    ['campos de más (el token no se lee nunca)', { installationId: 'inst-1', paired: true, token: 'x' }],
    ['id no válido', { installationId: '__proto__', paired: false }],
    ['paired no booleano', { installationId: 'inst-1', paired: 'sí' }],
  ])('devuelve undefined con %s', (_name, raw) => {
    expect(parseInstallation(raw)).toBeUndefined()
  })
})

describe('isRelevantChange', () => {
  it.each([
    ['local', ['localData']],
    ['local', ['localBindings']],
    ['local', ['installation']],
    ['local', ['backup']],
    ['local', ['pairing', 'installation']],
    ['session', ['shared']],
  ])('%s %j importa', (area, keys) => {
    expect(isRelevantChange(area, keys)).toBe(true)
  })

  it.each([
    ['local', ['pairing']],
    ['local', ['shared']],
    ['session', ['localData']],
    ['sync', ['localData']],
    ['managed', ['shared']],
    ['local', []],
  ])('%s %j no importa', (area, keys) => {
    expect(isRelevantChange(area, keys)).toBe(false)
  })
})

describe('backupSize', () => {
  it('sin copia son 0 bytes; con copia, los bytes UTF-8 de su JSON', () => {
    expect(backupSize(undefined)).toBe(0)
    expect(backupSize({ a: 'é' })).toBe(10)
  })
})
