import { describe, expect, it } from 'vitest'
import { hostNameFor, readBrands } from '../../src/platform/host-name'

const grease = { brand: 'Not)A;Brand', version: '8' }
const chromium = { brand: 'Chromium', version: '154' }

describe('hostNameFor', () => {
  it('Brave', () => {
    expect(hostNameFor([grease, chromium, { brand: 'Brave', version: '154' }])).toBe('com.curyapps.launcher.brave')
  })

  it('Microsoft Edge', () => {
    expect(hostNameFor([chromium, { brand: 'Microsoft Edge', version: '155' }, grease])).toBe(
      'com.curyapps.launcher.edge',
    )
  })

  it('Google Chrome', () => {
    expect(hostNameFor([{ brand: 'Google Chrome', version: '155' }, chromium, grease])).toBe(
      'com.curyapps.launcher.chrome',
    )
  })

  it('sin marca conocida (solo Chromium u otro navegador): undefined, nunca adivina', () => {
    expect(hostNameFor([chromium, grease])).toBeUndefined()
    expect(hostNameFor([{ brand: 'Opera', version: '120' }, chromium])).toBeUndefined()
  })

  it('varias marcas conocidas a la vez: undefined por ambigüedad', () => {
    expect(
      hostNameFor([
        { brand: 'Brave', version: '1' },
        { brand: 'Google Chrome', version: '1' },
      ]),
    ).toBeUndefined()
  })

  it('las marcas se comparan exactas (sin mayúsculas distintas ni subcadenas)', () => {
    expect(hostNameFor([{ brand: 'brave', version: '1' }])).toBeUndefined()
    expect(hostNameFor([{ brand: 'Brave Beta', version: '1' }])).toBeUndefined()
  })

  it('una marca repetida cuenta como varias', () => {
    expect(
      hostNameFor([
        { brand: 'Brave', version: '1' },
        { brand: 'Brave', version: '2' },
      ]),
    ).toBeUndefined()
  })

  it('userAgentData no disponible o con forma inesperada: undefined, nunca lanza', () => {
    for (const brands of [undefined, null, 'Brave', [], [null], [{}]]) {
      expect(hostNameFor(brands)).toBeUndefined()
    }
  })

  it('ignora entradas con forma inesperada pero acepta la marca válida', () => {
    expect(hostNameFor([null, { brand: 7 }, { brand: 'Brave', version: '1' }])).toBe('com.curyapps.launcher.brave')
  })
})

describe('readBrands', () => {
  it('lee navigator.userAgentData.brands tal cual', () => {
    const brand = { brand: 'Brave', version: '1' }
    expect(readBrands({ userAgentData: { brands: [brand] } })).toEqual([brand])
  })

  it('sin userAgentData o sin brands: undefined', () => {
    expect(readBrands({})).toBeUndefined()
    expect(readBrands({ userAgentData: null })).toBeUndefined()
    expect(readBrands({ userAgentData: 'x' })).toBeUndefined()
    expect(readBrands({ userAgentData: {} })).toBeUndefined()
  })
})
