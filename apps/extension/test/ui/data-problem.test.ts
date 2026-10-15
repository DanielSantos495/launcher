import type { UiError } from '@account-launcher/protocol'
import { describe, expect, it } from 'vitest'
import { isStoreFull, loadProblem } from '../../src/ui/lib/data-problem'

const PAIRED = { paired: true }
const UNPAIRED = { paired: false }

describe('isStoreFull', () => {
  it('solo too_large con la pista del almacén compartido', () => {
    expect(isStoreFull({ code: 'too_large', hint: 'shared_data_full' })).toBe(true)
    expect(isStoreFull({ code: 'too_large', hint: 'shared_bindings_full' })).toBe(false)
    expect(isStoreFull({ code: 'too_large' })).toBe(false)
    expect(isStoreFull({ code: 'internal', hint: 'shared_data_full' })).toBe(false)
  })
})

describe('loadProblem', () => {
  it.each<[string, UiError, 'too_large' | 'newer' | 'damaged' | 'host']>([
    ['datos de una versión más nueva', { code: 'invalid', hint: 'shared_data_newer' }, 'newer'],
    ['datos dañados', { code: 'invalid', hint: 'shared_data_invalid' }, 'damaged'],
    ['vínculos dañados', { code: 'invalid', hint: 'shared_bindings_invalid' }, 'damaged'],
    ['almacén lleno', { code: 'too_large', hint: 'shared_data_full' }, 'too_large'],
    ['programa ausente', { code: 'host_missing' }, 'host'],
    ['programa con error', { code: 'host_error', hint: 'timeout' }, 'host'],
  ])('%s', (_name, error, kind) => {
    expect(loadProblem(error, PAIRED)).toBe(kind)
  })

  it('un fallo del programa sin emparejar, o sin instalación conocida, no es un problema de la lista compartida', () => {
    expect(loadProblem({ code: 'host_missing' }, UNPAIRED)).toBeUndefined()
    expect(loadProblem({ code: 'host_error' }, undefined)).toBeUndefined()
  })

  it('los datos locales dañados y el resto de errores siguen siendo el error genérico', () => {
    expect(loadProblem({ code: 'internal', hint: 'local_data_invalid' }, PAIRED)).toBeUndefined()
    expect(loadProblem({ code: 'internal' }, PAIRED)).toBeUndefined()
    expect(loadProblem({ code: 'conflict' }, PAIRED)).toBeUndefined()
  })
})
