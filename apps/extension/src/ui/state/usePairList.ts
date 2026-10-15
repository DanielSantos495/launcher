import type { UiError, UiResults } from '@account-launcher/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Launcher } from './useLauncher'

export type PairList = UiResults['pair.list']

export interface PairListState {
  readonly list: PairList | undefined
  readonly error: UiError | undefined
  readonly refresh: () => Promise<void>
}

// Instalaciones emparejadas (pair.list). Se leen al activarse y al volver a la ventana; `refresh` las vuelve a pedir
// (por ejemplo, tras emparejar o quitar un perfil). Una respuesta tardía de una lectura anterior se descarta.
export function usePairList(send: Launcher['send'], active: boolean): PairListState {
  const [list, setList] = useState<PairList | undefined>()
  const [error, setError] = useState<UiError | undefined>()
  const alive = useRef(false)
  const counter = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++counter.current
    const response = await send({ type: 'pair.list' })
    if (!alive.current || counter.current !== seq) return
    if (response.ok) {
      setList(response.result)
      setError(undefined)
    } else {
      setError(response.error)
    }
  }, [send])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void refresh()
    const onFocus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [active, refresh])

  // Sin emparejar no hay lista: no se enseña una anterior.
  return { list: active ? list : undefined, error: active ? error : undefined, refresh }
}
