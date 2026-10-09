import type { KeyValueArea } from '../../src/background/deps'

export interface MemoryArea extends KeyValueArea {
  // Copia profunda del contenido actual.
  dump(): Record<string, unknown>
  // El siguiente set rechaza sin escribir nada.
  failNextSet(): void
  // Avisa con las claves que cambian en cada set o remove correcto. Devuelve la función que cancela el aviso.
  onChange(listener: (keys: string[]) => void): () => void
  // set cuenta cada llamada, también la que rechaza por failNextSet.
  readonly calls: { set: number }
}

// Área en memoria que se comporta como storage.local: guarda y devuelve copias (structuredClone), así que mutar
// lo leído no cambia lo guardado.
export function createMemoryArea(initial: Record<string, unknown> = {}): MemoryArea {
  const store = new Map<string, unknown>(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]))
  const listeners = new Set<(keys: string[]) => void>()
  const calls = { set: 0 }
  let failNext = false

  const notify = (keys: string[]): void => {
    if (keys.length === 0) return
    for (const listener of listeners) listener(keys)
  }

  return {
    calls,
    get(key) {
      return Promise.resolve(structuredClone(store.get(key)))
    },
    set(items) {
      calls.set++
      if (failNext) {
        failNext = false
        return Promise.reject(new Error('fallo simulado de storage.set'))
      }
      const keys = Object.keys(items)
      for (const key of keys) store.set(key, structuredClone(items[key]))
      notify(keys)
      return Promise.resolve()
    },
    remove(keys) {
      const removed = keys.filter((key) => store.delete(key))
      notify(removed)
      return Promise.resolve()
    },
    dump() {
      return Object.fromEntries([...store].map(([key, value]) => [key, structuredClone(value)]))
    },
    failNextSet() {
      failNext = true
    },
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
