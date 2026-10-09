import type { Queue } from './deps'

// FIFO: un trabajo cada vez. Un trabajo que falla rechaza su propia promesa y no bloquea a los siguientes.
export function createQueue(): Queue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      const result = tail.then(() => job())
      tail = result.catch(() => undefined)
      return result
    },
  }
}
