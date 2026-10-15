// @vitest-environment happy-dom
import { createEmptyData, type LauncherData } from '@account-launcher/core'
import type { UiRequestType } from '@account-launcher/protocol'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toUiResponse, type InstallationView, type LauncherClient } from '../../src/ui/client'
import { REFRESH_MS, useLauncher } from '../../src/ui/state/useLauncher'

interface FakeOptions {
  readonly source?: 'local' | 'shared'
  readonly host?: boolean
  readonly data?: () => LauncherData
  readonly failData?: boolean
}

interface Fake {
  readonly client: LauncherClient
  readonly calls: UiRequestType[]
  readonly count: (type: UiRequestType) => number
  readonly requests: { readonly type: string; readonly revision?: number }[]
  emitChange(): void
  readonly unsubscribed: { count: number }
}

const INSTALLATION: InstallationView = { installationId: 'inst-1', paired: false }

// Cliente falso: responde a cada tipo con un resultado fijo y apunta lo que recibe.
function createFake(options: FakeOptions = {}): Fake {
  const source = options.source ?? 'local'
  const calls: UiRequestType[] = []
  const requests: { type: string; revision?: number }[] = []
  const listeners = new Set<() => void>()
  const unsubscribed = { count: 0 }
  const answer = (type: UiRequestType): unknown => {
    switch (type) {
      case 'data.get':
        if (options.failData === true) return { ok: false, error: { code: 'internal', hint: 'local_data_invalid' } }
        return { ok: true, result: { data: options.data?.() ?? createEmptyData(), source } }
      case 'bindings.get':
        return { ok: true, result: { bindings: {} } }
      case 'capabilities.get':
        return {
          ok: true,
          result: {
            mode: 'multi',
            host:
              options.host === true
                ? { available: true, ping: { hostVersion: '0.1.0', protocol: 1, browser: 'brave', features: {} } }
                : { available: false },
            providers: [{ id: 'current', available: true }],
          },
        }
      case 'profiles.list':
        return {
          ok: true,
          result: { profiles: [{ directory: 'Default', name: 'Trabajo', isUsingDefaultName: false }] },
        }
      case 'sync.refresh':
        return { ok: true, result: { revision: 1 } }
      case 'data.mutate':
        return { ok: true, result: { revision: 2 } }
      default:
        return { ok: false, error: { code: 'internal' } }
    }
  }
  const client: LauncherClient = {
    send(request) {
      calls.push(request.type)
      requests.push(request.type === 'data.mutate' ? { type: request.type, revision: request.revision } : request)
      return Promise.resolve(toUiResponse<typeof request>(answer(request.type)))
    },
    installation: () => Promise.resolve(INSTALLATION),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        unsubscribed.count++
      }
    },
  }
  return {
    client,
    calls,
    requests,
    count: (type) => calls.filter((call) => call === type).length,
    emitChange: () => {
      for (const listener of listeners) listener()
    },
    unsubscribed,
  }
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useLauncher: carga inicial', () => {
  it('carga datos, vínculos, instalación y capacidades en paralelo y queda listo', async () => {
    const fake = createFake()
    const { result } = renderHook(() => useLauncher(fake.client))
    expect(result.current.state.status).toBe('loading')
    await flush()
    const { state } = result.current
    expect(state.status).toBe('ready')
    expect(state.source).toBe('local')
    expect(state.data?.revision).toBe(0)
    expect(state.bindings).toEqual({})
    expect(state.installation).toEqual(INSTALLATION)
    expect(state.capabilities?.mode).toBe('multi')
    expect(state.profiles).toEqual([])
    expect(fake.count('profiles.list')).toBe(0)
  })

  it('con el host disponible pide también los perfiles', async () => {
    const fake = createFake({ host: true })
    const { result } = renderHook(() => useLauncher(fake.client))
    await flush()
    expect(result.current.state.profiles.map((p) => p.name)).toEqual(['Trabajo'])
    expect(fake.calls.indexOf('profiles.list')).toBeGreaterThan(fake.calls.indexOf('capabilities.get'))
  })

  it('un error de data.get deja el estado en error con el código', async () => {
    const fake = createFake({ failData: true })
    const { result } = renderHook(() => useLauncher(fake.client))
    await flush()
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toEqual({ code: 'internal', hint: 'local_data_invalid' })
    expect(result.current.state.data).toBeUndefined()
  })
})

describe('useLauncher: sincronización', () => {
  it('con origen compartido hace sync.refresh al montar, a los 30 s y a los 60 s', async () => {
    const fake = createFake({ source: 'shared' })
    renderHook(() => useLauncher(fake.client))
    await flush()
    expect(fake.count('sync.refresh')).toBe(1)
    await flush(REFRESH_MS - 1)
    expect(fake.count('sync.refresh')).toBe(1)
    await flush(1)
    expect(fake.count('sync.refresh')).toBe(2)
    await flush(REFRESH_MS)
    expect(fake.count('sync.refresh')).toBe(3)
  })

  it('con origen local no hace sync.refresh nunca', async () => {
    const fake = createFake({ source: 'local' })
    renderHook(() => useLauncher(fake.client))
    await flush(REFRESH_MS * 3)
    expect(fake.count('sync.refresh')).toBe(0)
  })

  it('un evento focus con origen compartido hace un sync.refresh y vuelve a pedir las capacidades', async () => {
    const fake = createFake({ source: 'shared' })
    renderHook(() => useLauncher(fake.client))
    await flush()
    const before = { refresh: fake.count('sync.refresh'), caps: fake.count('capabilities.get') }
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(fake.count('sync.refresh')).toBe(before.refresh + 1)
    expect(fake.count('capabilities.get')).toBe(before.caps + 1)
  })

  it('focus y visibilitychange a la vez cuentan como un solo aviso', async () => {
    const fake = createFake({ source: 'shared' })
    renderHook(() => useLauncher(fake.client))
    await flush()
    const before = fake.count('sync.refresh')
    act(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()
    expect(fake.count('sync.refresh')).toBe(before + 1)
  })

  it('visibilitychange a oculta no hace nada', async () => {
    const fake = createFake({ source: 'shared' })
    renderHook(() => useLauncher(fake.client))
    await flush()
    const before = fake.calls.length
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()
    expect(fake.calls.length).toBe(before)
  })

  it('un evento focus con origen local pide capacidades pero no hace sync.refresh', async () => {
    const fake = createFake({ source: 'local', host: true })
    renderHook(() => useLauncher(fake.client))
    await flush()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(fake.count('sync.refresh')).toBe(0)
    expect(fake.count('capabilities.get')).toBe(2)
    expect(fake.count('profiles.list')).toBe(2)
  })

  it('al desmontar no hay más llamadas ni escuchas', async () => {
    const fake = createFake({ source: 'shared' })
    const { unmount } = renderHook(() => useLauncher(fake.client))
    await flush()
    unmount()
    expect(fake.unsubscribed.count).toBe(1)
    const before = fake.calls.length
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    fake.emitChange()
    await flush(REFRESH_MS * 3)
    expect(fake.calls.length).toBe(before)
  })

  it('desmontar antes de que respondan las primeras llamadas no encadena más', async () => {
    const fake = createFake({ source: 'shared', host: true })
    const { unmount } = renderHook(() => useLauncher(fake.client))
    unmount()
    await flush(REFRESH_MS * 2)
    expect(fake.count('profiles.list')).toBe(0)
    expect(fake.count('sync.refresh')).toBe(0)
  })
})

describe('useLauncher: cambios del almacenamiento', () => {
  it('agrupa varios avisos en una sola recarga a los 100 ms', async () => {
    const fake = createFake()
    renderHook(() => useLauncher(fake.client))
    await flush()
    const before = fake.count('data.get')
    act(() => {
      fake.emitChange()
      fake.emitChange()
      fake.emitChange()
    })
    await flush(99)
    expect(fake.count('data.get')).toBe(before)
    await flush(1)
    expect(fake.count('data.get')).toBe(before + 1)
    expect(fake.count('bindings.get')).toBe(before + 1)
  })

  it('una recarga no vuelve a pedir las capacidades si el modo no cambia', async () => {
    const fake = createFake()
    renderHook(() => useLauncher(fake.client))
    await flush()
    act(() => {
      fake.emitChange()
    })
    await flush(100)
    expect(fake.count('capabilities.get')).toBe(1)
  })

  it('si el modo cambia, vuelve a pedir las capacidades', async () => {
    let mode: 'single' | 'multi' = 'single'
    const fake = createFake({
      data: () => {
        const empty = createEmptyData()
        return { ...empty, settings: { ...empty.settings, mode } }
      },
    })
    renderHook(() => useLauncher(fake.client))
    await flush()
    mode = 'multi'
    act(() => {
      fake.emitChange()
    })
    await flush(100)
    expect(fake.count('capabilities.get')).toBe(2)
  })
})

describe('useLauncher: mutate y reload', () => {
  it('mutate envía data.mutate con la revisión actual y recarga', async () => {
    const fake = createFake({ data: () => ({ ...createEmptyData(), revision: 7 }) })
    const { result } = renderHook(() => useLauncher(fake.client))
    await flush()
    const loads = fake.count('data.get')
    let response: Awaited<ReturnType<typeof result.current.mutate>> | undefined
    await act(async () => {
      response = await result.current.mutate([{ type: 'settings.set', settings: { theme: 'dark' } }])
    })
    expect(response).toEqual({ ok: true, result: { revision: 2 } })
    expect(fake.requests.find((r) => r.type === 'data.mutate')?.revision).toBe(7)
    expect(fake.count('data.get')).toBe(loads + 1)
  })

  it('reload vuelve a pedir datos y capacidades', async () => {
    const fake = createFake()
    const { result } = renderHook(() => useLauncher(fake.client))
    await flush()
    await act(async () => {
      await result.current.reload()
    })
    expect(fake.count('data.get')).toBe(2)
    expect(fake.count('capabilities.get')).toBe(2)
  })

  it('send envía el mensaje tal cual', async () => {
    const fake = createFake()
    const { result } = renderHook(() => useLauncher(fake.client))
    await flush()
    let response: unknown
    await act(async () => {
      response = await result.current.send({ type: 'sync.refresh' })
    })
    expect(response).toEqual({ ok: true, result: { revision: 1 } })
  })
})
