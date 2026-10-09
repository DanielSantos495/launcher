import { BindingsSchema, createEmptyData, isUrlInGrammar, LIMITS, loadData, normalizeUrl } from '@account-launcher/core'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import responsesFixture from '../fixtures/host-responses.json'
import requestsFixture from '../fixtures/host-requests.json'
import {
  Base64Schema,
  HOST_COMMANDS,
  HOST_ERROR_CODES,
  HOST_RESULT_SCHEMAS,
  HostRequestSchema,
  hostRequest,
  isValidContainerName,
  parseHostResponse,
  type HostCommand,
} from '../src/host'
import { MAX_ICON_BYTES } from '../src/limits'

interface RequestCase {
  name: string
  valid: boolean
  error?: string
  request: unknown
}
interface ResponseCase {
  name: string
  cmd: HostCommand
  response: unknown
}

// Los fixtures son el contrato entre TypeScript y el host en Go: se cargan como JSON, sin acceso al disco.
const requests = requestsFixture as RequestCase[]
const responses = responsesFixture as ResponseCase[]

describe('contrato de peticiones (host-requests.json)', () => {
  it.each(requests.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(v.safeParse(HostRequestSchema, c.request).success).toBe(c.valid)
    if (!c.valid) expect(HOST_ERROR_CODES).toContain(c.error)
  })

  it('cubre cada comando con al menos un caso válido', () => {
    const covered = new Set(requests.filter((c) => c.valid).map((c) => (c.request as { cmd: string }).cmd))
    expect([...covered].sort()).toEqual([...HOST_COMMANDS].sort())
  })
})

describe('contrato de respuestas (host-responses.json)', () => {
  it.each(responses.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const r = parseHostResponse(c.cmd, c.response)
    const response = c.response as { ok: boolean; error?: unknown }
    if (response.ok) expect(r.ok).toBe(true)
    // Un error se devuelve tal cual: el mismo código (y la revisión de conflict) que el fixture.
    else expect(r).toEqual({ ok: false, error: response.error })
  })

  it('cubre cada comando con al menos una respuesta correcta', () => {
    const covered = new Set(responses.filter((c) => (c.response as { ok: boolean }).ok).map((c) => c.cmd))
    expect([...covered].sort()).toEqual([...HOST_COMMANDS].sort())
  })

  it('una respuesta con campos de más no es válida', () => {
    expect(parseHostResponse('open', { ok: true, result: { extra: 1 } })).toEqual({
      ok: false,
      error: { code: 'bad_response' },
    })
  })
})

describe('parseHostResponse', () => {
  it('conserva la revisión de un conflicto', () => {
    const raw = { ok: false, error: { code: 'conflict', revision: 5 } }
    expect(parseHostResponse('sync.put', raw)).toEqual({ ok: false, error: { code: 'conflict', revision: 5 } })
  })

  it('un código de error desconocido no es válido', () => {
    const raw = { ok: false, error: { code: 'teapot' } }
    expect(parseHostResponse('sync.get', raw)).toEqual({ ok: false, error: { code: 'bad_response' } })
  })

  it('un resultado de otro comando no es válido', () => {
    const raw = { ok: true, result: { revision: 4 } }
    expect(parseHostResponse('createProfile', raw)).toEqual({ ok: false, error: { code: 'bad_response' } })
  })

  it('un array no vale como resultado vacío', () => {
    expect(parseHostResponse('open', { ok: true, result: [] })).toEqual({ ok: false, error: { code: 'bad_response' } })
  })

  // conflict exige revision y revision solo se admite con conflict: son los cuatro casos de la combinación.
  it.each([
    ['conflict con revision es válido', { code: 'conflict', revision: 5 }, { code: 'conflict', revision: 5 }],
    ['conflict sin revision no es válido', { code: 'conflict' }, { code: 'bad_response' }],
    ['otro código con revision no es válido', { code: 'not_paired', revision: 5 }, { code: 'bad_response' }],
    ['otro código sin revision es válido', { code: 'not_paired' }, { code: 'not_paired' }],
  ])('%s', (_name, error, expected) => {
    expect(parseHostResponse('sync.put', { ok: false, error })).toEqual({ ok: false, error: expected })
  })
})

describe('Base64Schema: tamaño decodificado', () => {
  // btoa codifica una cadena de bytes (un carácter por byte): longitud / 4 * 3 - relleno es el tamaño decodificado.
  const base64Of = (bytes: number) => btoa('\0'.repeat(bytes))

  it('admite exactamente MAX_ICON_BYTES (32768, con relleno)', () => {
    const base64 = base64Of(MAX_ICON_BYTES)
    expect(base64).toHaveLength(43692)
    expect(base64.endsWith('=')).toBe(true)
    expect(v.safeParse(Base64Schema, base64).success).toBe(true)
  })

  it('rechaza 32769 bytes aunque la longitud (43692, sin relleno) cabe en el tope de caracteres', () => {
    const base64 = base64Of(MAX_ICON_BYTES + 1)
    expect(base64).toHaveLength(43692)
    expect(base64.endsWith('=')).toBe(false)
    expect(v.safeParse(Base64Schema, base64).success).toBe(false)
  })

  it('admite 32767 bytes (dos caracteres de relleno)', () => {
    const base64 = base64Of(MAX_ICON_BYTES - 1)
    expect(base64.endsWith('==')).toBe(true)
    expect(v.safeParse(Base64Schema, base64).success).toBe(true)
  })
})

describe('isValidContainerName (Review Focus 3)', () => {
  it('cuenta puntos de código, como las runas de Go', () => {
    expect(isValidContainerName('🎨'.repeat(33))).toBe(true)
    expect(isValidContainerName('🎨'.repeat(64))).toBe(true)
    expect(isValidContainerName('🎨'.repeat(65))).toBe(false)
  })

  it('rechaza los sustitutos UTF-16 sueltos y acepta los pares válidos', () => {
    expect(isValidContainerName('\ud800')).toBe(false)
    expect(isValidContainerName('a\udc00')).toBe(false)
    expect(isValidContainerName('Banco 😀')).toBe(true)
  })
})

describe('hostRequest', () => {
  it('construye el sobre con la versión', () => {
    expect(hostRequest('ping', {})).toEqual({ v: 1, cmd: 'ping', args: {} })
  })
})

describe('sync.get: el resultado solo se comprueba en su estructura (B5)', () => {
  const syncGet = (result: unknown) => parseHostResponse('sync.get', { ok: true, result })

  it('unos datos de otra versión no son bad_response, y loadData los rechaza con unsupported_version', () => {
    const r = syncGet({ revision: 7, data: { ...createEmptyData(), schemaVersion: 2, campoNuevo: [1] }, bindings: {} })
    expect(r.ok).toBe(true)
    expect(r.ok && loadData(r.value.data)).toEqual({ ok: false, error: { code: 'unsupported_version' } })
  })

  it('unos datos válidos pasan por loadData y unos vínculos válidos por BindingsSchema', () => {
    const data = { ...createEmptyData(), revision: 3 }
    const bindings = { 'id-home': { kind: 'chromium-profile', profileDirectory: 'Profile 1' } }
    const r = syncGet({ revision: 7, data, bindings })
    expect(r.ok && loadData(r.value.data)).toEqual({ ok: true, value: data })
    expect(r.ok && v.safeParse(BindingsSchema, r.value.bindings).success).toBe(true)
  })

  it('no valida cada vínculo: eso lo hace BindingsSchema después', () => {
    const r = syncGet({ revision: 0, data: null, bindings: { 'id-x': { kind: 'otro' } } })
    expect(r.ok).toBe(true)
    expect(r.ok && v.safeParse(BindingsSchema, r.value.bindings).success).toBe(false)
  })

  it.each([
    ['data como array', { revision: 0, data: [], bindings: {} }],
    ['data sin schemaVersion', { revision: 0, data: {}, bindings: {} }],
    ['schemaVersion 0', { revision: 0, data: { schemaVersion: 0 }, bindings: {} }],
    ['schemaVersion no entera', { revision: 0, data: { schemaVersion: 1.5 }, bindings: {} }],
    ['schemaVersion como texto', { revision: 0, data: { schemaVersion: '1' }, bindings: {} }],
    ['bindings como array', { revision: 0, data: null, bindings: [] }],
    ['bindings null', { revision: 0, data: null, bindings: null }],
    [
      'más de 100 vínculos',
      {
        revision: 0,
        data: null,
        bindings: Object.fromEntries(
          Array.from({ length: LIMITS.identities + 1 }, (_, n) => [`id-${String(n)}`, { kind: 'current' }]),
        ),
      },
    ],
    ['campo de más', { revision: 0, data: null, bindings: {}, extra: 1 }],
  ])('%s es bad_response', (_name, result) => {
    expect(syncGet(result)).toEqual({ ok: false, error: { code: 'bad_response' } })
  })
})

describe('listas de las respuestas: guarda de tamaño', () => {
  // Con la guarda, un elemento de más da un único error (el de la guarda) y no se valida ningún elemento.
  it('listProfiles con 501 perfiles {}', () => {
    const r = v.safeParse(HOST_RESULT_SCHEMAS.listProfiles, { profiles: new Array<object>(501).fill({}) })
    expect(r.issues?.map((issue) => issue.type)).toEqual(['check'])
  })

  it('pair.list con 17 instalaciones {}', () => {
    const r = v.safeParse(HOST_RESULT_SCHEMAS['pair.list'], {
      maxPairedProfiles: 2,
      installations: new Array<object>(17).fill({}),
    })
    expect(r.issues?.map((issue) => issue.type)).toEqual(['check'])
  })
})

describe('URLs de los fixtures y la gramática G (B2)', () => {
  const urls = requests.flatMap((c) => {
    const url = (c.request as { args?: { url?: unknown } } | null)?.args?.url
    return typeof url === 'string' ? [{ c, url }] : []
  })

  it('cada URL de un caso válido está en G y es canónica; cada URL de un caso bad_url está fuera de G', () => {
    const wrong = urls.filter(({ c, url }) =>
      c.valid ? !isUrlInGrammar(url) || new URL(url).href !== url : c.error === 'bad_url' && isUrlInGrammar(url),
    )
    expect(wrong.map(({ c }) => c.name)).toEqual([])
  })

  it('lo que acepta normalizeUrl está en G, y lo que está en G es canónico', () => {
    const wrong = urls.filter(({ url }) => {
      const r = normalizeUrl(url, { allowHttp: true })
      return (r.ok && !isUrlInGrammar(r.value)) || (isUrlInGrammar(url) && new URL(url).href !== url)
    })
    expect(wrong.map(({ c }) => c.name)).toEqual([])
    expect(urls.length).toBeGreaterThan(40)
  })
})
