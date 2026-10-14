import type { UiResponse } from '@account-launcher/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { WhoamiResult } from '../../src/background/internal-messages'
import { parseNonce, runWhoami, toWhoamiResponse, type WhoamiEnv, type WhoamiState } from '../../src/whoami/whoami'

const NONCE = 'a'.repeat(22)
const VERIFIED: UiResponse<WhoamiResult> = { ok: true, result: { verifiedAt: '2026-10-08T12:00:00.000Z' } }

describe('parseNonce', () => {
  it.each(['a'.repeat(16), 'a'.repeat(64), 'A-b_9'.repeat(4)])('acepta "#" + %s', (nonce) => {
    expect(parseNonce(`#${nonce}`)).toBe(nonce)
  })

  it.each([
    ['demasiado corto', '#short'],
    ['vacío', ''],
    ['solo la almohadilla', '#'],
    ['sin almohadilla', 'a'.repeat(20)],
    ['demasiado largo', `#${'a'.repeat(65)}`],
    ['con caracteres no permitidos', '#abc<script>xxxxxxxxx'],
    ['con un salto de línea al final', `#${'a'.repeat(20)}\n`],
    ['con dos almohadillas', `##${'a'.repeat(20)}`],
  ])('rechaza %s', (_name, hash) => {
    expect(parseNonce(hash)).toBeNull()
  })
})

// Entorno con un registro de llamadas en orden.
function setup(response: UiResponse<WhoamiResult> | Error, hash = `#${NONCE}`) {
  const calls: string[] = []
  const env: WhoamiEnv = {
    hash,
    send: vi.fn((message: { type: 'whoami.prove'; nonce: string }) => {
      calls.push(`send:${message.nonce}`)
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
    }),
    clearHash: vi.fn(() => {
      calls.push('clearHash')
    }),
    render: vi.fn((state: WhoamiState) => {
      calls.push(`render:${state}`)
    }),
    closeTab: vi.fn(() => {
      calls.push('closeTab')
      return Promise.resolve()
    }),
    sleep: vi.fn((ms: number) => {
      calls.push(`sleep:${String(ms)}`)
      return Promise.resolve()
    }),
  }
  return { env, calls }
}

describe('runWhoami', () => {
  it('con nonce válido envía la prueba, la muestra y cierra la pestaña después de 1,5 s', async () => {
    const { env, calls } = setup(VERIFIED)
    await runWhoami(env)
    expect(env.send).toHaveBeenCalledWith({ type: 'whoami.prove', nonce: NONCE })
    // El fragmento se borra antes de enviar; el nonce no se vuelve a usar.
    expect(calls).toEqual([
      'clearHash',
      'render:checking',
      `send:${NONCE}`,
      'render:verified',
      'sleep:1500',
      'closeTab',
    ])
  })

  it('con una respuesta de error muestra failed y no cierra la pestaña', async () => {
    const { env, calls } = setup({ ok: false, error: { code: 'bad_nonce' } })
    await runWhoami(env)
    expect(calls).toEqual(['clearHash', 'render:checking', `send:${NONCE}`, 'render:failed'])
    expect(env.closeTab).not.toHaveBeenCalled()
    expect(env.sleep).not.toHaveBeenCalled()
  })

  it('si el mensaje no llega al service worker muestra failed', async () => {
    const { env, calls } = setup(new Error('Could not establish connection'))
    await runWhoami(env)
    expect(calls).toEqual(['clearHash', 'render:checking', `send:${NONCE}`, 'render:failed'])
    expect(env.closeTab).not.toHaveBeenCalled()
  })

  it.each(['', '#corto', NONCE, `#${NONCE}x!`])(
    'con el fragmento "%s" muestra invalid y no envía nada',
    async (hash) => {
      const { env, calls } = setup(VERIFIED, hash)
      await runWhoami(env)
      expect(calls).toEqual(['render:invalid'])
      expect(env.send).not.toHaveBeenCalled()
      expect(env.closeTab).not.toHaveBeenCalled()
    },
  )

  it('si cerrar la pestaña falla, la página se queda mostrando verified', async () => {
    const { env } = setup(VERIFIED)
    vi.mocked(env.closeTab).mockRejectedValue(new Error('No tab'))
    await expect(runWhoami(env)).resolves.toBeUndefined()
    expect(vi.mocked(env.render).mock.calls.at(-1)).toEqual(['verified'])
  })

  it('el estado que se pinta nunca lleva el nonce', async () => {
    const { env } = setup({ ok: false, error: { code: 'bad_nonce' } })
    await runWhoami(env)
    for (const call of vi.mocked(env.render).mock.calls) expect(JSON.stringify(call)).not.toContain(NONCE)
  })
})

describe('toWhoamiResponse', () => {
  it('acepta una respuesta correcta', () => {
    expect(toWhoamiResponse(VERIFIED)).toEqual(VERIFIED)
  })

  it('una respuesta de error del service worker es un error sin el detalle (la página no lo muestra)', () => {
    expect(toWhoamiResponse({ ok: false, error: { code: 'bad_nonce' } })).toEqual({
      ok: false,
      error: { code: 'internal' },
    })
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['una cadena', 'ok'],
    ['una respuesta sin resultado', { ok: true }],
    ['una fecha no canónica', { ok: true, result: { verifiedAt: '2026-10-08' } }],
    ['un campo de más', { ok: true, result: { verifiedAt: '2026-10-08T12:00:00.000Z', extra: 1 } }],
  ])('%s es internal', (_name, raw) => {
    expect(toWhoamiResponse(raw)).toEqual({ ok: false, error: { code: 'internal' } })
  })
})
