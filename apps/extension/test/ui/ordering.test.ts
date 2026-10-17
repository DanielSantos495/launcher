import { describe, expect, it } from 'vitest'
import { moveIds } from '../../src/ui/lib/ordering'

interface Item {
  readonly id: string
  readonly band: string
}
const item = (id: string, band = 'x'): Item => ({ id, band })
const same = (a: Item, b: Item): boolean => a.band === b.band
const list = [item('a'), item('b'), item('c'), item('d')]

describe('moveIds', () => {
  it('sube y baja un puesto', () => {
    expect(moveIds(list, 'c', { step: -1 }, same)).toEqual(['a', 'c', 'b', 'd'])
    expect(moveIds(list, 'b', { step: 1 }, same)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('en los extremos no hay movimiento', () => {
    expect(moveIds(list, 'a', { step: -1 }, same)).toBeUndefined()
    expect(moveIds(list, 'd', { step: 1 }, same)).toBeUndefined()
  })

  it('soltar sobre otro elemento coloca en su puesto, hacia delante y hacia atrás', () => {
    expect(moveIds(list, 'a', { to: 'c' }, same)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveIds(list, 'd', { to: 'b' }, same)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('soltar sobre sí mismo o sobre un id desconocido no cambia nada', () => {
    expect(moveIds(list, 'b', { to: 'b' }, same)).toBeUndefined()
    expect(moveIds(list, 'b', { to: 'zz' }, same)).toBeUndefined()
    expect(moveIds(list, 'zz', { step: 1 }, same)).toBeUndefined()
  })

  it('no cruza la frontera de una banda distinta (favoritas, identidad propia)', () => {
    const banded = [item('f1', 'fav'), item('f2', 'fav'), item('n1'), item('n2')]
    expect(moveIds(banded, 'n1', { step: -1 }, same)).toBeUndefined()
    expect(moveIds(banded, 'f2', { step: 1 }, same)).toBeUndefined()
    expect(moveIds(banded, 'n2', { to: 'f1' }, same)).toBeUndefined()
    expect(moveIds(banded, 'f1', { step: 1 }, same)).toEqual(['f2', 'f1', 'n1', 'n2'])
  })

  it('no modifica la lista de entrada', () => {
    const before = [...list]
    moveIds(list, 'a', { to: 'd' }, same)
    expect(list).toEqual(before)
  })
})
