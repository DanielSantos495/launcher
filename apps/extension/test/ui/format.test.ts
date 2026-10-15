import { describe, expect, it } from 'vitest'
import { formatList } from '../../src/ui/lib/format'

describe('formatList', () => {
  it('une con "y" en español y con "and" en inglés', () => {
    expect(formatList('es', ['Ana', 'Beto', 'Cira'])).toBe('Ana, Beto y Cira')
    expect(formatList('en', ['Ana', 'Beto', 'Cira'])).toBe('Ana, Beto, and Cira')
  })

  it('un solo elemento queda tal cual y una lista vacía da texto vacío', () => {
    expect(formatList('es', ['Ana'])).toBe('Ana')
    expect(formatList('es', [])).toBe('')
  })
})
