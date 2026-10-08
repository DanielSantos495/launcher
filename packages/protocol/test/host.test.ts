import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import responsesFixture from '../fixtures/host-responses.json'
import requestsFixture from '../fixtures/host-requests.json'
import {
  HOST_COMMANDS,
  HOST_ERROR_CODES,
  HostRequestSchema,
  hostRequest,
  isValidContainerName,
  parseHostResponse,
  type HostCommand,
} from '../src/host'

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
    const expected = (c.response as { ok: boolean }).ok
    if (expected) expect(r.ok).toBe(true)
    else expect(!r.ok && r.error.code !== 'bad_response').toBe(true)
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
})

describe('isValidContainerName (Review Focus 3)', () => {
  it('cuenta puntos de código, como las runas de Go', () => {
    expect(isValidContainerName('🎨'.repeat(33))).toBe(true)
    expect(isValidContainerName('🎨'.repeat(64))).toBe(true)
    expect(isValidContainerName('🎨'.repeat(65))).toBe(false)
  })
})

describe('hostRequest', () => {
  it('construye el sobre con la versión', () => {
    expect(hostRequest('ping', {})).toEqual({ v: 1, cmd: 'ping', args: {} })
  })
})
