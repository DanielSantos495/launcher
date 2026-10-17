// @vitest-environment happy-dom
import { createEmptyData } from '@account-launcher/core'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toasts } from '../../src/ui/components/Toasts'
import { toUiResponse, type LauncherClient } from '../../src/ui/client'
import { useLauncher } from '../../src/ui/state/useLauncher'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type Resolver = (value: unknown) => void

// Cliente cuyas respuestas de `gated` esperan a que la prueba las suelte, para forzar que lleguen desordenadas.
function gatedClient(gated: 'data.get' | 'profiles.list') {
  const pending: Resolver[] = []
  const profiles = (names: string[]) => ({
    ok: true,
    result: { profiles: names.map((name) => ({ directory: name, name, isUsingDefaultName: false })) },
  })
  const client: LauncherClient = {
    send(request) {
      if (request.type === gated) {
        return new Promise((resolve) => {
          pending.push((value) => {
            resolve(toUiResponse<typeof request>(value))
          })
        })
      }
      const answers: Record<string, unknown> = {
        'data.get': { ok: true, result: { data: createEmptyData(), source: 'local' } },
        'bindings.get': { ok: true, result: { bindings: {} } },
        'capabilities.get': {
          ok: true,
          result: {
            mode: 'multi',
            host: { available: true, ping: { hostVersion: '0.1.0', protocol: 1, browser: 'brave', features: {} } },
            providers: [{ id: 'current', available: true }],
          },
        },
        'profiles.list': profiles(['Rapido']),
      }
      return Promise.resolve(
        toUiResponse<typeof request>(answers[request.type] ?? { ok: false, error: { code: 'internal' } }),
      )
    },
    installation: () => Promise.resolve({ installationId: 'inst-1', paired: false }),
    backupBytes: () => Promise.resolve(0),
    imageBytes: () => Promise.resolve(0),
    seenProfiles: () => Promise.resolve(undefined),
    saveSeenProfiles: () => Promise.resolve(),
    subscribe: () => () => undefined,
  }
  return { client, pending, profiles }
}

const flush = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useLauncher: respuestas obsoletas', () => {
  it('una carga de datos lenta que llega después de otra más reciente no pisa su resultado (coreSeq)', async () => {
    const { client, pending } = gatedClient('data.get')
    const { result } = renderHook(() => useLauncher(client))
    await flush()
    // Primera carga (montaje) en vuelo; la segunda empieza después.
    act(() => {
      void result.current.reload()
    })
    await flush()
    expect(pending).toHaveLength(2)
    const newer = { ...createEmptyData(), revision: 7 }
    const older = { ...createEmptyData(), revision: 1 }
    pending[1]?.({ ok: true, result: { data: newer, source: 'local' } })
    await flush()
    expect(result.current.state.data?.revision).toBe(7)
    pending[0]?.({ ok: true, result: { data: older, source: 'local' } })
    await flush()
    expect(result.current.state.data?.revision).toBe(7)
  })

  it('una lista de perfiles lenta de una consulta anterior no pisa la más reciente (hostSeq)', async () => {
    const { client, pending, profiles } = gatedClient('profiles.list')
    const { result } = renderHook(() => useLauncher(client))
    await flush()
    act(() => {
      void result.current.reload()
    })
    await flush()
    expect(pending).toHaveLength(2)
    pending[1]?.(profiles(['Nuevo']))
    await flush()
    expect(result.current.state.profiles.map((p) => p.name)).toEqual(['Nuevo'])
    pending[0]?.(profiles(['Viejo']))
    await flush()
    expect(result.current.state.profiles.map((p) => p.name)).toEqual(['Nuevo'])
  })
})

describe('Toasts: temporizador de avisos', () => {
  it('retira el aviso más antiguo a los 4 s justos y arranca el del siguiente', () => {
    const dismissed: number[] = []
    const onDismiss = (id: number): void => {
      dismissed.push(id)
    }
    const items = [
      { id: 1, text: 'uno' },
      { id: 2, text: 'dos' },
    ]
    const view = render(<Toasts toasts={items} onDismiss={onDismiss} />)
    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(dismissed).toEqual([])
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(dismissed).toEqual([1])
    // El padre retira el primero: el temporizador del segundo empieza de cero.
    view.rerender(<Toasts toasts={items.slice(1)} onDismiss={onDismiss} />)
    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(dismissed).toEqual([1])
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(dismissed).toEqual([1, 2])
  })

  it('al desmontar no queda ningún temporizador', () => {
    const onDismiss = vi.fn()
    const view = render(<Toasts toasts={[{ id: 1, text: 'uno' }]} onDismiss={onDismiss} />)
    view.unmount()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
