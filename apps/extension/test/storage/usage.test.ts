import { describe, expect, it } from 'vitest'
import { jsonBytes, utf8Bytes } from '../../src/storage/usage'

describe('utf8Bytes', () => {
  it('cuenta bytes UTF-8, no caracteres', () => {
    expect(utf8Bytes('')).toBe(0)
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('é')).toBe(2)
    expect(utf8Bytes('€')).toBe(3)
    expect(utf8Bytes('😀')).toBe(4)
  })
})

describe('jsonBytes', () => {
  it('mide el JSON serializado en bytes UTF-8', () => {
    expect(jsonBytes({})).toBe(2)
    expect(jsonBytes({ a: 'é' })).toBe(10)
    expect(jsonBytes(['😀'])).toBe(8)
    expect(jsonBytes(null)).toBe(4)
  })
})
