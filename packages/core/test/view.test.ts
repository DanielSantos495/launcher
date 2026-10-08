import { describe, expect, it } from 'vitest'
import { buildSections, sortAccounts } from '../src/view'
import { account, data, group, identity } from './fixtures'

const people = [identity({ order: 0 }), identity({ id: 'id-home', label: 'Casa', order: 1 })]

describe('sortAccounts', () => {
  it('favoritas primero, luego orden y etiqueta', () => {
    const list = [
      account({ id: 'c', label: 'C', order: 1 }),
      account({ id: 'b', label: 'B', order: 0 }),
      account({ id: 'a', label: 'A', order: 0 }),
      account({ id: 'f', label: 'Z', order: 9, favorite: true }),
    ]
    expect(sortAccounts(list).map((a) => a.id)).toEqual(['f', 'a', 'b', 'c'])
  })

  it('con todo igual el orden no depende del de entrada: desempata por id', () => {
    const list = ['b', 'c', 'a'].map((id) => account({ id, label: 'Igual' }))
    expect(sortAccounts(list).map((a) => a.id)).toEqual(['a', 'b', 'c'])
    expect(sortAccounts([...list].reverse()).map((a) => a.id)).toEqual(['a', 'b', 'c'])
  })

  it('"Árbol" y "arbol" empatan en texto y desempatan por id', () => {
    const accented = account({ id: 'a-1', label: 'Árbol' })
    const plain = account({ id: 'z-1', label: 'arbol' })
    expect(sortAccounts([accented, plain]).map((a) => a.id)).toEqual(['a-1', 'z-1'])
    expect(sortAccounts([plain, accented]).map((a) => a.id)).toEqual(['a-1', 'z-1'])
  })

  it('ordena los números por su valor: "cuenta 2" va antes que "cuenta 10"', () => {
    const list = [account({ id: 'a', label: 'cuenta 10' }), account({ id: 'b', label: 'cuenta 2' })]
    expect(sortAccounts(list).map((a) => a.label)).toEqual(['cuenta 2', 'cuenta 10'])
  })

  it('devuelve una lista nueva y no modifica la de entrada', () => {
    const list = [account({ id: 'c', label: 'C' }), account({ id: 'b', label: 'B' }), account({ id: 'a', label: 'A' })]
    const before = structuredClone(list)
    const sorted = sortAccounts(list)
    expect(sorted).not.toBe(list)
    expect(list).toEqual(before)
  })
})

describe('buildSections', () => {
  const accounts = [account({ id: 'w1' }), account({ id: 'h1', identityId: 'id-home', groupId: 'grp-dev' })]
  const d = data({ identities: people, groups: [group()], accounts })

  it('vista por identidad: la del perfil actual va primero (D18)', () => {
    expect(buildSections(d, 'identity', 'id-home').map((s) => s.key)).toEqual(['identity:id-home', 'identity:id-work'])
    expect(buildSections(d, 'identity').map((s) => s.key)).toEqual(['identity:id-work', 'identity:id-home'])
  })

  it('vista por identidad: cada cuenta en la sección de su identidad y ordenada', () => {
    const owned = data({
      identities: people,
      accounts: [
        account({ id: 'w2', label: 'Beta', order: 1 }),
        account({ id: 'w1', label: 'Alfa', order: 1 }),
        account({ id: 'wf', label: 'Zeta', order: 5, favorite: true }),
        account({ id: 'h2', identityId: 'id-home', label: 'Dos', order: 2 }),
        account({ id: 'h1', identityId: 'id-home', label: 'Uno', order: 1 }),
      ],
    })
    const sections = buildSections(owned, 'identity')
    expect(sections.map((s) => [s.key, s.identityId, s.accounts.map((a) => a.id)])).toEqual([
      ['identity:id-work', 'id-work', ['wf', 'w1', 'w2']],
      ['identity:id-home', 'id-home', ['h1', 'h2']],
    ])
    // Pertenencia: todas las cuentas aparecen y cada una solo en una sección.
    expect(sections.flatMap((s) => s.accounts.map((a) => a.id)).sort()).toEqual(['h1', 'h2', 'w1', 'w2', 'wf'])
  })

  it('incluye identidades sin cuentas', () => {
    const empty = data({ identities: people })
    expect(buildSections(empty, 'identity').map((s) => s.accounts.length)).toEqual([0, 0])
  })

  it('vista por grupo: grupos por orden y "sin grupo" al final', () => {
    expect(buildSections(d, 'group').map((s) => [s.key, s.accounts.map((a) => a.id)])).toEqual([
      ['group:grp-dev', ['h1']],
      ['ungrouped', ['w1']],
    ])
  })

  it('desempata identidades y grupos por etiqueta y no crea "sin grupo" vacío', () => {
    const tied = data({
      identities: [identity({ id: 'id-b', label: 'B' }), identity({ id: 'id-a', label: 'A' })],
      groups: [
        group({ id: 'grp-z', name: 'Z', order: 1 }),
        group({ id: 'grp-b', name: 'B' }),
        group({ id: 'grp-a', name: 'A' }),
      ],
      accounts: [account({ id: 'x', identityId: 'id-a', groupId: 'grp-z' })],
    })
    expect(buildSections(tied, 'identity', 'id-a').map((s) => s.key)).toEqual(['identity:id-a', 'identity:id-b'])
    expect(buildSections(tied, 'identity', 'id-desconocida').map((s) => s.key)).toEqual([
      'identity:id-a',
      'identity:id-b',
    ])
    expect(buildSections(tied, 'group').map((s) => s.key)).toEqual(['group:grp-a', 'group:grp-b', 'group:grp-z'])
  })

  it('con orden y texto equivalentes, identidades y grupos desempatan por id sea cual sea el orden de entrada', () => {
    const identities = [
      identity({ id: 'id-a', label: 'Árbol' }),
      identity({ id: 'id-z', label: 'arbol' }),
      identity({ id: 'id-m', label: 'ARBOL' }),
    ]
    const groups = [
      group({ id: 'grp-a', name: 'Árbol' }),
      group({ id: 'grp-z', name: 'arbol' }),
      group({ id: 'grp-m', name: 'ARBOL' }),
    ]
    for (const [i, g] of [
      [identities, groups],
      [[...identities].reverse(), [...groups].reverse()],
    ] as const) {
      const tied = data({ identities: i, groups: g })
      expect(buildSections(tied, 'identity').map((s) => s.key)).toEqual([
        'identity:id-a',
        'identity:id-m',
        'identity:id-z',
      ])
      expect(buildSections(tied, 'group').map((s) => s.key)).toEqual(['group:grp-a', 'group:grp-m', 'group:grp-z'])
    }
  })

  it('ordena identidades y grupos con números por su valor', () => {
    const numbered = data({
      identities: [identity({ id: 'id-a', label: 'Persona 10' }), identity({ id: 'id-b', label: 'Persona 2' })],
      groups: [group({ id: 'grp-a', name: 'Grupo 10' }), group({ id: 'grp-b', name: 'Grupo 2' })],
    })
    expect(buildSections(numbered, 'identity').map((s) => s.key)).toEqual(['identity:id-b', 'identity:id-a'])
    expect(buildSections(numbered, 'group').map((s) => s.key)).toEqual(['group:grp-b', 'group:grp-a'])
  })

  describe('no modifica los datos de entrada', () => {
    // Entrada desordenada a propósito: una ordenación o un movimiento en el sitio la cambiarían.
    const messy = data({
      identities: [identity({ id: 'id-home', label: 'Casa', order: 1 }), identity({ order: 0 })],
      groups: [group({ id: 'grp-b', name: 'B', order: 1 }), group({ id: 'grp-a', name: 'A', order: 0 })],
      accounts: [
        account({ id: 'z', identityId: 'id-home', groupId: 'grp-b', label: 'Z' }),
        account({ id: 'y', groupId: 'grp-a', label: 'Y', favorite: true }),
        account({ id: 'x', groupId: null, label: 'X' }),
      ],
    })

    it.each([
      ['vista por identidad', 'identity', undefined],
      ['vista por identidad con la del perfil actual', 'identity', 'id-home'],
      ['vista por grupo', 'group', undefined],
    ] as const)('en la %s', (_name, view, own) => {
      const input = structuredClone(messy)
      buildSections(input, view, own)
      expect(input).toEqual(messy)
    })
  })
})
