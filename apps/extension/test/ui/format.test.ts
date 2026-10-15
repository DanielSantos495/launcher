import { describe, expect, it } from 'vitest'
import { formatCountdown, formatDateTime, formatKb, formatList } from '../../src/ui/lib/format'

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

describe('formatKb', () => {
  it('muestra KiB con los decimales pedidos y el separador del idioma', () => {
    expect(formatKb('es', 503_316, 1)).toBe('491,5 KB')
    expect(formatKb('en', 503_316, 1)).toBe('491.5 KB')
    expect(formatKb('es', 524_288, 0)).toBe('512 KB')
    expect(formatKb('es', 0, 1)).toBe('0,0 KB')
  })
})

describe('formatCountdown', () => {
  it('da m:ss con los segundos siempre en dos cifras', () => {
    expect(formatCountdown(120)).toBe('2:00')
    expect(formatCountdown(119)).toBe('1:59')
    expect(formatCountdown(61)).toBe('1:01')
    expect(formatCountdown(9)).toBe('0:09')
    expect(formatCountdown(0)).toBe('0:00')
  })

  it('los negativos cuentan como cero y los decimales se truncan', () => {
    expect(formatCountdown(-5)).toBe('0:00')
    expect(formatCountdown(59.9)).toBe('0:59')
  })
})

describe('formatDateTime', () => {
  it('formatea una marca ISO en el idioma pedido', () => {
    const es = formatDateTime('es', '2026-10-08T12:00:00.000Z')
    const en = formatDateTime('en', '2026-10-08T12:00:00.000Z')
    expect(es).toMatch(/2026/)
    expect(en).toMatch(/Oct/)
    expect(es).not.toBe(en)
  })

  it('una marca no válida da texto vacío', () => {
    expect(formatDateTime('es', 'ayer')).toBe('')
  })
})
