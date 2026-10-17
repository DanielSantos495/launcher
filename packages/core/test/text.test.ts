import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { isWellFormed, wellFormed } from '../src/text'

describe('isWellFormed', () => {
  it.each([
    ['', true],
    ['Ana', true],
    ['😀', true], // par sustituto válido
    ['a😀b', true],
    ['\ud800', false],
    ['a\udc00b', false],
    ['x\ud83d', false], // alto suelto al final
    ['\ude00\ud83d', false], // par invertido
    ['😀\ud800', false], // sustituto suelto pegado a un par válido
  ])('%j → %s', (input, expected) => {
    expect(isWellFormed(input)).toBe(expected)
  })
})

describe('wellFormed', () => {
  const schema = v.pipe(v.string(), wellFormed)

  it('acepta el texto bien formado', () => {
    expect(v.safeParse(schema, 'a😀b').success).toBe(true)
  })

  it('rechaza un sustituto suelto con el mensaje compartido', () => {
    const result = v.safeParse(schema, 'x\ud83d')
    expect(result.success).toBe(false)
    expect(result.issues?.[0]?.message).toBe('texto mal formado')
  })
})
