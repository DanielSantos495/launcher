import { describe, expect, it } from 'vitest'
import { createQueue } from '../../src/background/queue'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('createQueue', () => {
  it('ejecuta un trabajo cada vez y en orden de llegada', async () => {
    const queue = createQueue()
    const events: string[] = []
    const gate = deferred()
    const a = queue.run(async () => {
      events.push('A:start')
      await gate.promise
      events.push('A:end')
    })
    const b = queue.run(() => {
      events.push('B:start')
      events.push('B:end')
      return Promise.resolve()
    })
    // B no puede empezar mientras A espera.
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['A:start'])
    gate.resolve()
    await Promise.all([a, b])
    expect(events).toEqual(['A:start', 'A:end', 'B:start', 'B:end'])
  })

  it('devuelve el valor de cada trabajo', async () => {
    const queue = createQueue()
    await expect(queue.run(() => Promise.resolve(42))).resolves.toBe(42)
  })

  it('un trabajo que rechaza rechaza su promesa con el mismo error y no bloquea al siguiente', async () => {
    const queue = createQueue()
    const failure = new Error('fallo')
    const first = queue.run(() => Promise.reject(failure))
    const second = queue.run(() => Promise.resolve('ok'))
    await expect(first).rejects.toBe(failure)
    await expect(second).resolves.toBe('ok')
  })

  it('un trabajo que lanza de forma síncrona rechaza su promesa y la cola sigue', async () => {
    const queue = createQueue()
    const failure = new Error('síncrono')
    const first = queue.run((): Promise<never> => {
      throw failure
    })
    await expect(first).rejects.toBe(failure)
    await expect(queue.run(() => Promise.resolve('sigue'))).resolves.toBe('sigue')
  })
})
