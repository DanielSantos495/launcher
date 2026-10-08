import { describe, expect, it } from 'vitest'
import { compareId, compareText } from '../src/compare'

describe('compareText', () => {
  it('ignora mayúsculas y tildes: el texto equivalente empata', () => {
    expect(compareText('Árbol', 'arbol')).toBe(0)
    expect(compareText('GITHUB', 'github')).toBe(0)
  })

  it('compara los números por su valor', () => {
    expect(compareText('cuenta 2', 'cuenta 10')).toBeLessThan(0)
    expect(compareText('cuenta 10', 'cuenta 2')).toBeGreaterThan(0)
  })

  it('ordena con el alfabeto español, sin depender del idioma del entorno: ñ va entre n y o', () => {
    expect(['o', 'ñ', 'z', 'n'].sort(compareText)).toEqual(['n', 'ñ', 'o', 'z'])
  })

  it('ordena de forma alfabética', () => {
    expect(compareText('a', 'B')).toBeLessThan(0)
    expect(compareText('B', 'a')).toBeGreaterThan(0)
  })
})

describe('compareId', () => {
  it('distingue mayúsculas y compara por unidades de código, sin criterio numérico', () => {
    expect(compareId('A', 'a')).toBeLessThan(0)
    expect(compareId('a', 'A')).toBeGreaterThan(0)
    expect(compareId('acc-10', 'acc-2')).toBeLessThan(0)
  })

  it('devuelve 0 solo para ids idénticos', () => {
    expect(compareId('acc-1', 'acc-1')).toBe(0)
    expect(compareId('acc-1', 'acc-2')).toBeLessThan(0)
  })
})
