// Límite de trabajos a la vez, FIFO: los que no caben esperan su turno. Un trabajo que falla libera su hueco.
export interface Limiter {
  run<T>(job: () => Promise<T>): Promise<T>
}

export function createLimiter(max: number): Limiter {
  let active = 0
  const waiting: (() => void)[] = []
  const release = (): void => {
    const next = waiting.shift()
    if (next === undefined) active--
    else next()
  }
  return {
    async run<T>(job: () => Promise<T>): Promise<T> {
      if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve))
      else active++
      try {
        return await job()
      } finally {
        release()
      }
    },
  }
}
