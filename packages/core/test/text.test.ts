import { describe, expect, it } from 'vitest'
import { isWellFormed } from '../src/text'

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
  ])('%j → %s', (input, expected) => {
    expect(isWellFormed(input)).toBe(expected)
  })
})
