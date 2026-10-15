import type { Binding, ProfileInfo } from '@account-launcher/core'
import { describe, expect, it } from 'vitest'
import { desiredNameError, renameStatus } from '../../src/ui/lib/rename'

const bound = (desiredName?: string): Binding => ({
  kind: 'chromium-profile',
  profileDirectory: 'Profile 1',
  ...(desiredName === undefined ? {} : { desiredName }),
})
const profile = (name: string, isUsingDefaultName: boolean, directory = 'Profile 1'): ProfileInfo => ({
  directory,
  name,
  isUsingDefaultName,
})

describe('renameStatus', () => {
  it('matches: el perfil se llama como se pidió y el nombre lo eligió el usuario', () => {
    expect(renameStatus(bound('Trabajo'), [profile('Trabajo', false)])).toBe('matches')
  })

  it('pending: el nombre por defecto no cuenta aunque coincida', () => {
    expect(renameStatus(bound('Persona 1'), [profile('Persona 1', true)])).toBe('pending')
  })

  it('pending: el perfil tiene otro nombre', () => {
    expect(renameStatus(bound('Trabajo'), [profile('Personal', false)])).toBe('pending')
  })

  it('pending: la comparación distingue mayúsculas', () => {
    expect(renameStatus(bound('Trabajo'), [profile('trabajo', false)])).toBe('pending')
  })

  it('missing: la carpeta ya no está en la lista de perfiles', () => {
    expect(renameStatus(bound('Trabajo'), [profile('Trabajo', false, 'Profile 2')])).toBe('missing')
    expect(renameStatus(bound('Trabajo'), [])).toBe('missing')
  })

  it('none: sin nombre pedido, vínculo current o sin vínculo', () => {
    expect(renameStatus(bound(), [profile('Trabajo', false)])).toBe('none')
    expect(renameStatus({ kind: 'current' }, [profile('Trabajo', false)])).toBe('none')
    expect(renameStatus(undefined, [profile('Trabajo', false)])).toBe('none')
  })

  it('none tiene prioridad sobre missing cuando no se pidió nombre', () => {
    expect(renameStatus(bound(), [])).toBe('none')
  })
})

describe('desiredNameError', () => {
  it('un nombre normal vale y los espacios de los extremos no cuentan', () => {
    expect(desiredNameError('Trabajo')).toBeUndefined()
    expect(desiredNameError('  Trabajo  ')).toBeUndefined()
  })

  it('vacío o en blanco es field.required', () => {
    expect(desiredNameError('')).toBe('field.required')
    expect(desiredNameError('   ')).toBe('field.required')
  })

  it('80 caracteres valen y 81 son field.too_long', () => {
    expect(desiredNameError('a'.repeat(80))).toBeUndefined()
    expect(desiredNameError('a'.repeat(81))).toBe('field.too_long')
  })

  it('los caracteres de control son field.invalid_text', () => {
    expect(desiredNameError('Tra\u0000bajo')).toBe('field.invalid_text')
    expect(desiredNameError('Tra\nbajo')).toBe('field.invalid_text')
  })
})
