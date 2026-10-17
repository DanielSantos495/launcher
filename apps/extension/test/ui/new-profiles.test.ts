import type { ProfileInfo } from '@account-launcher/core'
import { describe, expect, it } from 'vitest'
import { markSeen, reviewProfiles, SEEN_LIMIT } from '../../src/ui/lib/new-profiles'

const profile = (directory: string, name = directory): ProfileInfo => ({ directory, name, isUsingDefaultName: false })
const NO_BOUND: ReadonlySet<string> = new Set()

describe('reviewProfiles', () => {
  it('la primera vez marca todas como vistas, sin aviso', () => {
    const result = reviewProfiles([profile('Default'), profile('Profile 1')], undefined, NO_BOUND)
    expect(result.fresh).toEqual([])
    expect(result.nextSeen).toEqual(['Default', 'Profile 1'])
  })

  it('la primera vez con la lista vacía no guarda nada (aún no se ha leído la lista)', () => {
    expect(reviewProfiles([], undefined, NO_BOUND)).toEqual({ fresh: [], nextSeen: undefined })
  })

  it('avisa de la carpeta que no se había visto', () => {
    const result = reviewProfiles([profile('Default'), profile('Profile 2', 'Nuevo')], ['Default'], NO_BOUND)
    expect(result.fresh.map((p) => p.directory)).toEqual(['Profile 2'])
    expect(result.nextSeen).toBeUndefined()
  })

  it('no avisa de las vistas ni de las que ya tienen vínculo', () => {
    const result = reviewProfiles(
      [profile('Default'), profile('Profile 2'), profile('Profile 3')],
      ['Default'],
      new Set(['Profile 2']),
    )
    expect(result.fresh.map((p) => p.directory)).toEqual(['Profile 3'])
  })
})

describe('markSeen', () => {
  it('añade sin repetir y conserva el orden', () => {
    expect(markSeen(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('el tope es 200: se descartan las más antiguas (máximo y máximo + 1)', () => {
    const base = Array.from({ length: SEEN_LIMIT }, (_, i) => `p${String(i)}`)
    expect(markSeen(base, [])).toHaveLength(SEEN_LIMIT)
    const grown = markSeen(base, ['nuevo'])
    expect(grown).toHaveLength(SEEN_LIMIT)
    expect(grown[0]).toBe('p1')
    expect(grown.at(-1)).toBe('nuevo')
  })
})
