import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import {
  BindingSchema,
  BindingsSchema,
  createEmptyData,
  formatIssues,
  IdSchema,
  isSafeDirectoryName,
  LabelSchema,
  LIMITS,
  MAX_ISSUES,
  parseLauncherData,
  ProfileDirectorySchema,
  ProfileInfoSchema,
  validateData,
} from '../src/schema'
import { MAX_URL_LENGTH } from '../src/url'
import { account, data, group, identity, T0 } from './fixtures'

describe('parseLauncherData', () => {
  it('acepta datos vacíos y datos completos', () => {
    expect(parseLauncherData(createEmptyData()).ok).toBe(true)
    const full = data({ groups: [group()], accounts: [account({ groupId: 'grp-dev' })] })
    expect(parseLauncherData(full)).toEqual({ ok: true, value: full })
  })

  it('rechaza campos desconocidos', () => {
    expect(parseLauncherData({ ...createEmptyData(), extra: 1 }).ok).toBe(false)
  })

  it('un __proto__ de JSON.parse no llega a los datos ni contamina prototipos', () => {
    const raw: unknown = JSON.parse(
      '{"schemaVersion":1,"revision":0,"identities":[],"groups":[],"accounts":[],"customServices":[],' +
        '"settings":{"mode":"single","language":"auto","defaultView":"identity","theme":"system","allowHttp":false},' +
        '"__proto__":{"polluted":true}}',
    )
    // strictObject rechaza la clave __proto__ propia que crea JSON.parse.
    expect(parseLauncherData(raw).ok).toBe(false)
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  it.each([
    ['color', identity({ color: 'red' })],
    ['etiqueta vacía', identity({ label: '   ' })],
    ['etiqueta con control', identity({ label: 'a\u0007b' })],
    ['etiqueta larga', identity({ label: 'x'.repeat(LIMITS.label + 1) })],
    ['email', identity({ email: 'no-es-email' })],
    ['fecha', identity({ createdAt: 'ayer' })],
    ['id', identity({ id: 'con espacio' })],
  ])('rechaza identidad con %s no válido', (_name, bad) => {
    expect(parseLauncherData(data({ identities: [bad] })).ok).toBe(false)
  })

  it('acepta notas con saltos de línea y rechaza otros controles', () => {
    expect(parseLauncherData(data({ accounts: [account({ notes: 'línea 1\nlínea 2' })] })).ok).toBe(true)
    expect(parseLauncherData(data({ accounts: [account({ notes: 'a\u0000b' })] })).ok).toBe(false)
  })

  it('rechaza más cuentas que el límite', () => {
    const accounts = Array.from({ length: LIMITS.accounts + 1 }, (_, i) => account({ id: `acc-${String(i)}` }))
    expect(parseLauncherData(data({ accounts })).ok).toBe(false)
  })

  it('devuelve mensajes con la ruta del campo', () => {
    const r = parseLauncherData(data({ identities: [identity({ color: 'red' })] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.some((m) => m.startsWith('identities.0.color'))).toBe(true)
  })

  it('los mensajes llevan ruta y tipo de regla, nunca valores recibidos', () => {
    const r = parseLauncherData(data({ identities: [identity({ email: 'no es un email@example.com' })] }))
    expect(r).toEqual({ ok: false, error: ['identities.0.email: email'] })
  })

  it('los mensajes no incluyen emails, URLs ni claves desconocidas con forma de email', () => {
    const badEmail = 'ana.secreta @example.com'
    const longUrl = `javascript:alert(1)//${'x'.repeat(MAX_URL_LENGTH)}`
    const unknownKey = 'ana.secreta@example.com'
    const base = data({ accounts: [account({ url: longUrl })] })
    const raw: unknown = {
      ...base,
      identities: [{ ...identity({ email: badEmail }), [unknownKey]: 1 }],
      settings: { ...base.settings, mode: 'valor-secreto@example.com' },
    }
    const r = parseLauncherData(raw)
    expect(r.ok).toBe(false)
    if (r.ok) return
    const text = r.error.join('\n')
    expect(text).not.toContain(badEmail)
    expect(text).not.toContain('secreta')
    expect(text).not.toContain('example.com')
    expect(text).not.toContain('javascript')
    expect(text).not.toContain('valor-secreto')
    expect(r.error).toEqual(
      expect.arrayContaining([
        'identities.0.email: email',
        'identities.0.?: strict_object',
        'accounts.0.url: max_length',
        'settings.mode: picklist',
      ]),
    )
  })

  it('un javascript: válido para el esquema no aparece en el mensaje de validateData', () => {
    const r = parseLauncherData(data({ accounts: [account({ url: 'javascript:alert(1)' })] }))
    expect(r).toEqual({ ok: false, error: ['accounts.acc-github: URL no válida'] })
  })

  it.each(['__proto__', 'constructor', 'prototype'])('rechaza %s como id', (id) => {
    expect(v.safeParse(IdSchema, id).success).toBe(false)
    expect(parseLauncherData(data({ identities: [identity({ id })] })).ok).toBe(false)
  })

  it.each([
    ['fecha inexistente', '2026-02-31T00:00:00.000Z'],
    ['mes inexistente', '2026-13-01T00:00:00.000Z'],
    ['con espacio y desfase', '2026-10-07 12:00:00+05:00'],
    ['con desfase', '2026-10-07T12:00:00.000+05:00'],
    ['sin milisegundos', '2026-10-07T12:00:00Z'],
  ])('rechaza marca de tiempo no canónica: %s', (_name, createdAt) => {
    expect(parseLauncherData(data({ identities: [identity({ createdAt })] })).ok).toBe(false)
  })

  it('acepta marcas de tiempo canónicas', () => {
    for (const createdAt of ['2026-10-07T12:00:00.000Z', '2024-02-29T23:59:59.999Z']) {
      expect(parseLauncherData(data({ identities: [identity({ createdAt })] })).ok).toBe(true)
    }
  })

  it('acepta un emoji y rechaza controles en el emoji', () => {
    expect(parseLauncherData(data({ accounts: [account({ icon: { type: 'emoji', value: '🙂' } })] })).ok).toBe(true)
    expect(parseLauncherData(data({ accounts: [account({ icon: { type: 'emoji', value: 'a\u0007' } })] })).ok).toBe(
      false,
    )
  })
})

describe('validateData', () => {
  it.each([
    ['ids repetidos', data({ identities: [identity(), identity()] })],
    ['identidad desconocida', data({ accounts: [account({ identityId: 'otra' })] })],
    ['grupo desconocido', data({ accounts: [account({ groupId: 'otro' })] })],
    ['servicio personalizado desconocido', data({ accounts: [account({ serviceId: 'custom:nada' })] })],
    ['URL javascript:', data({ accounts: [account({ url: 'javascript:alert(1)' })] })],
    ['URL http sin permiso', data({ accounts: [account({ url: 'http://intranet.example/' })] })],
    ['genérico sin URL', data({ accounts: [account({ serviceId: 'generic' })] })],
  ])('detecta %s', (_name, d) => {
    expect(validateData(d).ok).toBe(false)
  })

  it('detecta ids de cuenta repetidos', () => {
    expect(validateData(data({ accounts: [account(), account()] }))).toEqual({
      ok: false,
      error: ['accounts.acc-github: id repetido'],
    })
  })

  it('acepta una cuenta que referencia un servicio personalizado existente', () => {
    const service = {
      id: 'slack',
      name: 'Slack',
      urlTemplate: 'https://{username}.slack.com/',
      multiAccount: 'parallel' as const,
      createdAt: '2026-10-07T12:00:00.000Z',
      updatedAt: '2026-10-07T12:00:00.000Z',
    }
    const d = data({ customServices: [service], accounts: [account({ serviceId: 'custom:slack' })] })
    expect(validateData(d).ok).toBe(true)
    expect(parseLauncherData(d)).toEqual({ ok: true, value: d })
  })

  it('acepta http si allowHttp está activo', () => {
    const d = data({
      accounts: [account({ url: 'http://intranet.example/' })],
      settings: { ...createEmptyData().settings, allowHttp: true },
    })
    expect(validateData(d).ok).toBe(true)
  })

  it('valida las plantillas de los servicios personalizados', () => {
    const service = {
      id: 'slack',
      name: 'Slack',
      urlTemplate: 'javascript:{username}',
      multiAccount: 'parallel' as const,
      createdAt: '2026-10-07T12:00:00.000Z',
      updatedAt: '2026-10-07T12:00:00.000Z',
    }
    expect(validateData(data({ customServices: [service] })).ok).toBe(false)
    expect(
      validateData(data({ customServices: [{ ...service, urlTemplate: 'https://{username}.slack.com/' }] })).ok,
    ).toBe(true)
  })
})

describe('carpetas de perfil', () => {
  it.each([['.'], ['..'], ['-x'], ['a/b'], ['a\\b'], ['a\u0000b'], ['a\ud800']])(
    'isSafeDirectoryName rechaza %j',
    (name) => {
      expect(isSafeDirectoryName(name)).toBe(false)
      expect(v.safeParse(ProfileDirectorySchema, name).success).toBe(false)
    },
  )

  it.each([[''], ['x'.repeat(256)]])('ProfileDirectorySchema rechaza vacío y demasiado largo (%#)', (name) => {
    expect(v.safeParse(ProfileDirectorySchema, name).success).toBe(false)
  })

  it.each([['Profile 1'], ['Default'], ['Launcher-1a2b3c4d']])('acepta %s', (name) => {
    expect(isSafeDirectoryName(name)).toBe(true)
    expect(v.safeParse(ProfileDirectorySchema, name).success).toBe(true)
  })
})

describe('BindingsSchema', () => {
  const valid = {
    'id-work': { kind: 'chromium-profile', profileDirectory: 'Profile 1', desiredName: 'Trabajo' },
    'id-home': { kind: 'chromium-profile', profileDirectory: 'Default' },
    'id-here': { kind: 'current' },
  }

  it('acepta vínculos con y sin desiredName', () => {
    const r = v.safeParse(BindingsSchema, valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.output).toEqual(valid)
  })

  it.each([
    ['tipo desconocido', { 'id-work': { kind: 'otro' } }],
    ['campo extra', { 'id-work': { kind: 'current', extra: 1 } }],
    ['carpeta no válida', { 'id-work': { kind: 'chromium-profile', profileDirectory: '../x' } }],
    [
      'nombre con control',
      { 'id-work': { kind: 'chromium-profile', profileDirectory: 'Default', desiredName: 'a\u0007' } },
    ],
    ['clave no válida', { 'con espacio': { kind: 'current' } }],
    ['no es un objeto', 'texto'],
    ['una lista vacía', []],
    ['una lista con un vínculo', [{ kind: 'current' }]],
  ])('rechaza %s', (_name, input) => {
    expect(v.safeParse(BindingsSchema, input).success).toBe(false)
  })

  it.each(['__proto__', 'constructor', 'prototype'])('rechaza %s como clave', (key) => {
    const raw: unknown = JSON.parse(`{"${key}":{"kind":"current"}}`)
    expect(v.safeParse(BindingsSchema, raw).success).toBe(false)
    expect(Object.prototype).not.toHaveProperty('kind')
  })

  it('rechaza más vínculos que identidades', () => {
    const many = Object.fromEntries(
      Array.from({ length: LIMITS.identities + 1 }, (_, i) => [`id-${String(i)}`, { kind: 'current' }]),
    )
    expect(v.safeParse(BindingsSchema, many).success).toBe(false)
  })
})

describe('ProfileInfoSchema', () => {
  const valid = { directory: 'Profile 1', name: 'Trabajo', isUsingDefaultName: false, color: '#1f6feb' }

  it('acepta un perfil válido con y sin color', () => {
    expect(v.safeParse(ProfileInfoSchema, valid).success).toBe(true)
    expect(
      v.safeParse(ProfileInfoSchema, { directory: 'Default', name: 'Persona 1', isUsingDefaultName: true }).success,
    ).toBe(true)
  })

  it.each([
    ['carpeta no válida', { ...valid, directory: '../x' }],
    ['nombre demasiado largo', { ...valid, name: 'x'.repeat(257) }],
    ['color no válido', { ...valid, color: 'red' }],
    ['campo extra', { ...valid, extra: 1 }],
    ['falta isUsingDefaultName', { directory: 'Default', name: 'Persona 1' }],
  ])('rechaza %s', (_name, input) => {
    expect(v.safeParse(ProfileInfoSchema, input).success).toBe(false)
  })
})

describe('textos bien formados (punto 30 de f1a-decisiones)', () => {
  const service = {
    id: 'slack',
    name: 'Slack',
    urlTemplate: 'https://{username}.slack.com/',
    multiAccount: 'parallel' as const,
    createdAt: T0,
    updatedAt: T0,
  }
  // Datos válidos con todos los campos de texto presentes; cada fila cambia uno solo.
  const withAccount = (over: Parameters<typeof account>[0]) =>
    data({
      groups: [group()],
      customServices: [service],
      accounts: [account({ groupId: 'grp-dev', username: 'ana', notes: 'nota', url: 'https://example.com/', ...over })],
    })
  const launcherIssues = (input: unknown): string[] => {
    const r = parseLauncherData(input)
    return r.ok ? [] : r.error
  }
  const schemaIssues = (schema: v.GenericSchema, input: unknown): string[] => {
    const r = v.safeParse(schema, input)
    return r.success ? [] : formatIssues(r.issues)
  }

  // [campo, issues esperados al rechazar, issues del campo con el valor dado, rechazado, aceptado]
  // El email trae además 'email': v.email también rechaza el sustituto, pero el error de bien formado se da siempre.
  const rows: [string, string[], (value: string) => string[], string, string][] = [
    [
      'identities[0].label',
      ['identities.0.label: check'],
      (value) => launcherIssues(data({ identities: [identity({ label: value })] })),
      'Trabajo\ud800',
      'Trabajo 😀',
    ],
    [
      'identities[0].email',
      ['identities.0.email: check', 'identities.0.email: email'],
      (value) => launcherIssues(data({ identities: [identity({ email: value })] })),
      'a\ud800@example.com',
      'ana@example.com',
    ],
    [
      'groups[0].name',
      ['groups.0.name: check'],
      (value) => launcherIssues(data({ groups: [group({ name: value })] })),
      '\udc00',
      'Grupo 😀',
    ],
    [
      'accounts[0].label',
      ['accounts.0.label: check'],
      (value) => launcherIssues(withAccount({ label: value })),
      'x\ud800',
      'x 😀',
    ],
    [
      'accounts[0].username',
      ['accounts.0.username: check'],
      (value) => launcherIssues(withAccount({ username: value })),
      'u\ud800',
      'u😀',
    ],
    [
      'accounts[0].notes',
      ['accounts.0.notes: check'],
      (value) => launcherIssues(withAccount({ notes: value })),
      'nota\ud800',
      'nota 😀\n\tsegunda línea',
    ],
    [
      'accounts[0].url',
      ['accounts.0.url: check'],
      (value) => launcherIssues(withAccount({ url: value })),
      'https://example.com/\ud800',
      'https://example.com/😀',
    ],
    [
      'accounts[0].icon (emoji)',
      ['accounts.0.icon.value: check'],
      (value) => launcherIssues(withAccount({ icon: { type: 'emoji', value } })),
      '\ud83d',
      '😀',
    ],
    [
      'customServices[0].name',
      ['customServices.0.name: check'],
      (value) => launcherIssues(data({ customServices: [{ ...service, name: value }] })),
      'S\ud800',
      'S 😀',
    ],
    [
      'customServices[0].urlTemplate',
      ['customServices.0.urlTemplate: check'],
      (value) => launcherIssues(data({ customServices: [{ ...service, urlTemplate: value }] })),
      'https://example.com/{username}\ud800',
      'https://example.com/{username}',
    ],
    [
      'BindingSchema desiredName',
      ['desiredName: check'],
      (value) =>
        schemaIssues(BindingSchema, { kind: 'chromium-profile', profileDirectory: 'Default', desiredName: value }),
      'P\ud800',
      'Perfil 😀',
    ],
    [
      'ProfileInfoSchema name',
      ['name: check'],
      (value) => schemaIssues(ProfileInfoSchema, { directory: 'Default', name: value, isUsingDefaultName: false }),
      'Persona\ud800',
      'Persona 😀',
    ],
    [
      'ProfileDirectorySchema',
      ['check'],
      (value) => schemaIssues(ProfileDirectorySchema, value),
      'Profile\ud800',
      'Profile 1',
    ],
  ]

  it.each(rows)(
    '%s: rechaza un sustituto suelto y acepta texto bien formado',
    (_field, expected, issues, bad, good) => {
      const rejected = issues(bad)
      expect(rejected).toEqual(expected)
      // El mensaje lleva la ruta y el tipo de regla, nunca el texto recibido (ni crudo ni escapado).
      const text = JSON.stringify(rejected)
      expect(text).not.toContain(bad)
      expect(text).not.toContain(JSON.stringify(bad).slice(1, -1))
      expect(issues(good)).toEqual([])
    },
  )

  it('un par sustituto válido (emoji) no se confunde con un sustituto suelto', () => {
    expect(isSafeDirectoryName('Perfil 😀')).toBe(true)
    expect(v.safeParse(LabelSchema, 'a😀b').success).toBe(true)
    expect(v.safeParse(LabelSchema, '\ude00\ud83d').success).toBe(false)
  })
})

describe('guardas de tamaño (T5)', () => {
  // Más de un millón de elementos: sin la guarda, Valibot valida y acumula errores de cada uno (segundos y GB).
  const HOSTILE = 1_600_000

  it.each(['identities', 'groups', 'accounts', 'customServices'] as const)(
    '%s: un array enorme se rechaza sin validar sus elementos',
    (key) => {
      const raw = { ...createEmptyData(), [key]: new Array<object>(HOSTILE).fill({}) }
      const start = performance.now()
      const r = parseLauncherData(raw)
      expect(performance.now() - start).toBeLessThan(1000)
      expect(r).toEqual({ ok: false, error: [`${key}: check`] })
    },
  )

  it.each(['identities', 'groups', 'accounts', 'customServices'] as const)(
    '%s: con un elemento de más, el único error es el de la guarda (los elementos no se validan)',
    (key) => {
      const raw = { ...createEmptyData(), [key]: new Array<object>(LIMITS[key] + 1).fill({}) }
      expect(parseLauncherData(raw)).toEqual({ ok: false, error: [`${key}: check`] })
    },
  )

  it('BindingsSchema cuenta las claves antes de validar cada vínculo', () => {
    const many = Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`id-${String(i)}`, {}]))
    const r = v.safeParse(BindingsSchema, many)
    expect(r.issues?.map((issue) => issue.type)).toEqual(['check'])
  })

  it('MAX_ISSUES es 50 y formatIssues no devuelve más mensajes', () => {
    expect(MAX_ISSUES).toBe(50)
    // 2000 cuentas vacías caben en el límite y dan miles de errores de esquema.
    const r = parseLauncherData({ ...createEmptyData(), accounts: new Array<object>(LIMITS.accounts).fill({}) })
    expect(r.ok ? [] : r.error).toHaveLength(MAX_ISSUES)
  })

  it('validateData tampoco devuelve más de MAX_ISSUES mensajes', () => {
    const accounts = Array.from({ length: LIMITS.accounts }, (_, i) =>
      account({ id: `acc-${String(i)}`, identityId: 'nadie' }),
    )
    const r = validateData(data({ accounts }))
    expect(r.ok ? [] : r.error).toHaveLength(MAX_ISSUES)
  })
})

describe('LabelSchema', () => {
  it('es la regla de las etiquetas: no vacía, sin controles y como mucho LIMITS.label', () => {
    expect(v.safeParse(LabelSchema, 'Trabajo').success).toBe(true)
    expect(v.safeParse(LabelSchema, 'x'.repeat(LIMITS.label)).success).toBe(true)
    expect(v.safeParse(LabelSchema, 'x'.repeat(LIMITS.label + 1)).success).toBe(false)
    expect(v.safeParse(LabelSchema, '   ').success).toBe(false)
    expect(v.safeParse(LabelSchema, 'a\u0007b').success).toBe(false)
  })
})
