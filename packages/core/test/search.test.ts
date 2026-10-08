import { describe, expect, it } from 'vitest'
import { normalizeText, searchAccounts } from '../src/search'
import { account, data, identity } from './fixtures'

const people = [identity(), identity({ id: 'id-home', label: 'Casa', email: 'casa@example.com' })]
const accounts = [
  account({ id: 'gh', label: 'GitHub trabajo', username: 'ana-dev' }),
  account({ id: 'gm', label: 'Correo', serviceId: 'google.gmail' }),
  account({ id: 'cl', label: 'Claude casa', serviceId: 'claude', identityId: 'id-home' }),
  account({ id: 'ge', label: 'Gémini', serviceId: 'google.gemini', favorite: true }),
]
const d = data({ identities: people, accounts })
const ids = (query: string) => searchAccounts(d, query).map((h) => h.account.id)

describe('normalizeText', () => {
  it('quita tildes y pasa a minúsculas', () => {
    expect(normalizeText('Gémini ÑANDÚ')).toBe('gemini nandu')
  })
})

describe('searchAccounts', () => {
  it('busca por nombre, servicio, usuario, identidad y email', () => {
    expect(ids('github')).toEqual(['gh'])
    expect(ids('gmail')).toEqual(['gm'])
    expect(ids('ana-dev')).toEqual(['gh'])
    expect(ids('casa@')).toEqual(['cl'])
    expect(ids('casa')).toEqual(['cl'])
  })

  it('no distingue tildes ni mayúsculas', () => {
    expect(ids('GEMINI')).toEqual(['ge'])
    expect(ids('gémini')).toEqual(['ge'])
  })

  it('todas las palabras deben coincidir', () => {
    expect(ids('claude casa')).toEqual(['cl'])
    expect(ids('claude trabajo')).toEqual([])
  })

  it('ordena el prefijo por delante de la subcadena', () => {
    const d2 = data({ accounts: [account({ id: 'x', label: 'Mi git' }), account({ id: 'y', label: 'Git' })] })
    expect(searchAccounts(d2, 'git').map((h) => h.account.id)).toEqual(['y', 'x'])
  })

  it('sin consulta devuelve todas, con las favoritas primero', () => {
    expect(ids('')[0]).toBe('ge')
    expect(ids('   ')).toHaveLength(4)
  })

  it('las abiertas en los últimos 7 días suben', () => {
    const recent = account({ id: 'r', label: 'Web B', lastOpenedAt: '2026-10-07T10:00:00.000Z' })
    const old = account({ id: 'o', label: 'Web A' })
    const d2 = data({ accounts: [old, recent] })
    const hits = searchAccounts(d2, 'web', { now: new Date('2026-10-08T00:00:00.000Z') })
    expect(hits.map((h) => h.account.id)).toEqual(['r', 'o'])
  })

  it('respeta el límite', () => {
    expect(searchAccounts(d, '', { limit: 2 })).toHaveLength(2)
  })

  it('trata los caracteres especiales como texto (Review Focus 5)', () => {
    const d2 = data({ accounts: [account({ id: 'cpp', label: 'C++ docs' })] })
    expect(searchAccounts(d2, 'c++').map((h) => h.account.id)).toEqual(['cpp'])
    for (const q of ['(', '.*', '[', '\\']) {
      expect(() => searchAccounts(d2, q)).not.toThrow()
    }
  })
})

describe('niveles de puntuación y casos límite', () => {
  // Servicio "github" por defecto: el nombre "GitHub" no interfiere con los términos de estas pruebas.
  const scored = (accountsList: ReturnType<typeof account>[], query: string) =>
    searchAccounts(data({ accounts: accountsList }), query).map((h) => [h.account.id, h.score] as const)

  it('el inicio de palabra (60) va por delante de la subcadena dentro de una palabra (40)', () => {
    const list = [account({ id: 'inside', label: 'Mi hola' }), account({ id: 'word', label: 'Mi ola' })]
    expect(scored(list, 'ola')).toEqual([
      ['word', 60],
      ['inside', 40],
    ])
  })

  it('la subsecuencia (10) solo cuenta si no hay subcadena, y queda por debajo', () => {
    const list = [
      account({ id: 'seq', label: 'Cuenta personal' }),
      account({ id: 'sub', label: 'Mi xgthbx', serviceId: 'generic' }),
    ]
    const hits = scored(list, 'gthb')
    // "gthb" está dentro de la etiqueta de sub (40) y solo es subsecuencia del servicio "GitHub" de seq (10 x 0,8).
    expect(hits.map(([id]) => id)).toEqual(['sub', 'seq'])
    expect(hits[0]?.[1]).toBe(40)
    expect(hits[1]?.[1]).toBeCloseTo(8)
  })

  it('un término de un carácter ausente no coincide por subsecuencia', () => {
    const list = [account({ id: 'a', label: 'Mi cuenta' })]
    expect(scored(list, 'q')).toEqual([])
    // Presente: puntúa por su nivel normal (subcadena 40), nunca como subsecuencia.
    expect(scored(list, 'u')).toEqual([['a', 40]])
  })

  it('una cuenta con identidad inexistente se encuentra por su etiqueta sin lanzar', () => {
    const orphan = account({ id: 'orphan', identityId: 'id-missing', label: 'Huérfana', serviceId: 'generic' })
    const d2 = data({ accounts: [orphan] })
    expect(searchAccounts(d2, 'huerfana').map((h) => h.account.id)).toEqual(['orphan'])
    // Sin identidad no hay email ni etiqueta de identidad que puedan coincidir.
    expect(searchAccounts(d2, 'trabajo')).toEqual([])
    expect(searchAccounts(d2, 'example')).toEqual([])
    expect(searchAccounts(d2, '')).toHaveLength(1)
  })

  it('una cuenta con servicio desconocido se encuentra por su etiqueta sin lanzar', () => {
    const unknown = account({ id: 'unk', serviceId: 'custom:no-existe', label: 'Servicio raro' })
    const d2 = data({ accounts: [unknown] })
    expect(searchAccounts(d2, 'raro').map((h) => h.account.id)).toEqual(['unk'])
    expect(searchAccounts(d2, 'servicio raro').map((h) => h.account.id)).toEqual(['unk'])
    // Sin nombre de servicio no hay nada que coincida con "github".
    expect(searchAccounts(d2, 'github')).toEqual([])
    expect(searchAccounts(d2, '')).toHaveLength(1)
  })

  it('con la misma puntuación desempata por orden alfabético de la etiqueta', () => {
    const list = [
      account({ id: 'c', label: 'Web C' }),
      account({ id: 'a', label: 'Web A' }),
      account({ id: 'b', label: 'Web B' }),
    ]
    const hits = scored(list, 'web')
    expect(new Set(hits.map(([, score]) => score)).size).toBe(1)
    expect(hits.map(([id]) => id)).toEqual(['a', 'b', 'c'])
  })

  it('con puntuación y etiqueta equivalentes desempata por id, sea cual sea el orden de entrada', () => {
    // "Árbol" y "arbol" empatan en texto (sin tildes ni mayúsculas) y en puntuación.
    const accented = account({ id: 'a-1', label: 'Árbol', serviceId: 'generic' })
    const plain = account({ id: 'z-1', label: 'arbol', serviceId: 'generic' })
    expect(scored([accented, plain], 'arbol').map(([id]) => id)).toEqual(['a-1', 'z-1'])
    expect(scored([plain, accented], 'arbol').map(([id]) => id)).toEqual(['a-1', 'z-1'])
    expect(scored([plain, accented], '').map(([id]) => id)).toEqual(['a-1', 'z-1'])
  })

  it('ordena los números de la etiqueta por su valor: "cuenta 2" va antes que "cuenta 10"', () => {
    const list = [account({ id: 'a', label: 'Cuenta 10' }), account({ id: 'b', label: 'Cuenta 2' })]
    const hits = scored(list, 'cuenta')
    expect(new Set(hits.map(([, score]) => score)).size).toBe(1)
    expect(hits.map(([id]) => id)).toEqual(['b', 'a'])
  })
})

describe('puntuaciones exactas, consulta acotada y límites', () => {
  const T0 = '2026-10-07T12:00:00.000Z'
  const NOW = new Date('2026-10-08T00:00:00.000Z')
  const scoredIn = (d2: ReturnType<typeof data>, query: string, options: { limit?: number; now?: Date } = {}) =>
    searchAccounts(d2, query, { now: NOW, ...options }).map((h) => [h.account.id, h.score] as const)

  it('el texto igual (100) va por delante del prefijo (70)', () => {
    // serviceId "generic" ("Web") e identidad por defecto no pueden coincidir con "git".
    const d2 = data({
      accounts: [
        account({ id: 'prefix', label: 'Gitx', serviceId: 'generic' }),
        account({ id: 'exact', label: 'Git', serviceId: 'generic' }),
      ],
    })
    expect(scoredIn(d2, 'git')).toEqual([
      ['exact', 100],
      ['prefix', 70],
    ])
  })

  it('el prefijo del campo (70) va por delante del inicio de palabra (60)', () => {
    // El servicio por defecto ("GitHub") y la identidad no pueden coincidir con "web".
    const d2 = data({ accounts: [account({ id: 'word', label: 'Mi web' }), account({ id: 'prefix', label: 'Web A' })] })
    expect(scoredIn(d2, 'web')).toEqual([
      ['prefix', 70],
      ['word', 60],
    ])
  })

  it('cada campo pesa distinto: etiqueta 1, servicio 0,8, usuario 0,7, email 0,6 e identidad 0,5', () => {
    // El mismo texto exacto ("zeta") en un solo campo de cada cuenta; el resto de campos no puede coincidir.
    const d2 = data({
      identities: [
        identity(),
        identity({ id: 'id-email', email: 'zeta' }),
        identity({ id: 'id-label', label: 'zeta' }),
      ],
      customServices: [
        {
          id: 'zeta',
          name: 'Zeta',
          urlTemplate: 'https://example.com/',
          multiAccount: 'none',
          createdAt: T0,
          updatedAt: T0,
        },
      ],
      accounts: [
        account({ id: 'identity-label', label: 'Cuenta I', identityId: 'id-label' }),
        account({ id: 'email', label: 'Cuenta E', identityId: 'id-email' }),
        account({ id: 'username', label: 'Cuenta U', username: 'zeta' }),
        account({ id: 'service', label: 'Cuenta S', serviceId: 'custom:zeta' }),
        account({ id: 'label', label: 'Zeta' }),
      ],
    })
    expect(scoredIn(d2, 'zeta')).toEqual([
      ['label', 100],
      ['service', 80],
      ['username', 70],
      ['email', 60],
      ['identity-label', 50],
    ])
  })

  it('una consulta de 1000 términos repetidos equivale al término único', () => {
    const single = scoredIn(d, 'casa')
    // 40 repeticiones de "casa " son exactamente los 200 caracteres que se conservan.
    expect(scoredIn(d, 'casa '.repeat(1000))).toEqual(single)
    expect(single.map(([id]) => id)).toEqual(['cl'])
  })

  it('los términos repetidos no suman puntuación', () => {
    expect(scoredIn(d, 'casa casa casa')).toEqual(scoredIn(d, 'casa'))
    // Con 9 repetidos delante, el término distinto siguiente sigue contando: no cabe en los 8 primeros sin deduplicar.
    expect(scoredIn(d, `${'casa '.repeat(9)}zzzz`)).toEqual([])
  })

  it('solo usa los 8 primeros términos distintos', () => {
    const eight = 'github trabajo ana-dev ana@ example com dev ana'
    expect(scoredIn(d, eight).map(([id]) => id)).toEqual(['gh'])
    // El noveno término no coincide con nada y se ignora; en octavo lugar sí cuenta.
    expect(scoredIn(d, `${eight} zzzz`).map(([id]) => id)).toEqual(['gh'])
    expect(scoredIn(d, 'github trabajo ana-dev ana@ example com dev zzzz')).toEqual([])
  })

  it('solo mira los primeros 200 caracteres de la consulta', () => {
    expect(scoredIn(d, `github${' '.repeat(250)}zzzz`).map(([id]) => id)).toEqual(['gh'])
    expect(scoredIn(d, `github${' '.repeat(100)}zzzz`)).toEqual([])
  })

  it('acota el límite: negativo da 0, decimal se trunca y no finito usa 50', () => {
    const many = data({
      accounts: Array.from({ length: 60 }, (_, i) => account({ id: `a${String(i)}`, label: `Cuenta ${String(i)}` })),
    })
    const count = (limit?: number) => scoredIn(many, '', limit === undefined ? {} : { limit }).length
    expect(count()).toBe(50)
    expect(count(Number.NaN)).toBe(50)
    expect(count(Number.POSITIVE_INFINITY)).toBe(50)
    expect(count(Number.NEGATIVE_INFINITY)).toBe(50)
    expect(count(-1)).toBe(0)
    expect(count(0)).toBe(0)
    expect(count(2.9)).toBe(2)
    expect(count(60)).toBe(60)
  })

  it('una marca de apertura futura no cuenta como reciente; los límites de la ventana sí', () => {
    const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
    const week = 7 * 24 * 60 * 60 * 1000
    const d2 = data({
      accounts: [
        account({ id: 'future', label: 'Web F', lastOpenedAt: at(1) }),
        account({ id: 'now', label: 'Web N', lastOpenedAt: at(0) }),
        account({ id: 'edge', label: 'Web E', lastOpenedAt: at(-week) }),
        account({ id: 'old', label: 'Web O', lastOpenedAt: at(-week - 1) }),
      ],
    })
    // Recientes (73) primero, por orden alfabético; sin impulso (70) después.
    expect(scoredIn(d2, 'web')).toEqual([
      ['edge', 73],
      ['now', 73],
      ['future', 70],
      ['old', 70],
    ])
  })
})
