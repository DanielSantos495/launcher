import { vi } from 'vitest'
import type { MemoryArea } from './memory-area'

// Cada lectura toma su valor al llamar y responde un poco más tarde. Sin la cola, dos manejadores a la vez verían
// el mismo estado anterior: es lo que permite probar que la cola evita pisarse.
export function slowReads(area: MemoryArea): void {
  const get = area.get.bind(area)
  vi.spyOn(area, 'get').mockImplementation(async (key) => {
    const value = await get(key)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return value
  })
}
