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
})

describe('buildSections', () => {
  const accounts = [account({ id: 'w1' }), account({ id: 'h1', identityId: 'id-home', groupId: 'grp-dev' })]
  const d = data({ identities: people, groups: [group()], accounts })

  it('vista por identidad: la del perfil actual va primero (D18)', () => {
    expect(buildSections(d, 'identity', 'id-home').map((s) => s.key)).toEqual(['identity:id-home', 'identity:id-work'])
    expect(buildSections(d, 'identity').map((s) => s.key)).toEqual(['identity:id-work', 'identity:id-home'])
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
})
