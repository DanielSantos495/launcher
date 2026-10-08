import { describe, expect, it } from 'vitest'
import { err, ok } from '../src/result'

describe('Result', () => {
  it('ok envuelve el valor', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 })
  })
  it('err envuelve el error', () => {
    expect(err('x')).toEqual({ ok: false, error: 'x' })
  })
})
