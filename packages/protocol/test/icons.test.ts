import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { decodeCanonicalBase64, isValidIconImage, matchesMagic, UploadedIconKeySchema } from '../src/icons'
import { MAX_ICON_BYTES } from '../src/limits'

function base64Of(bytes: number[], size = bytes.length): string {
  const full = new Uint8Array(size)
  full.set(bytes)
  let binary = ''
  for (const byte of full) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]

describe('UploadedIconKeySchema', () => {
  it.each(['icon:a', 'icon:img-1', 'icon:A_b-9', `icon:${'a'.repeat(64)}`])('acepta %s', (key) => {
    expect(v.is(UploadedIconKeySchema, key)).toBe(true)
  })
  it.each(['icon:__proto__', 'icon:constructor', 'icon:prototype', 'icon:', 'a', 'icon:a b', `icon:${'a'.repeat(65)}`])(
    'rechaza %s',
    (key) => {
      expect(v.is(UploadedIconKeySchema, key)).toBe(false)
    },
  )
})

describe('decodeCanonicalBase64', () => {
  it('el límite: MAX_ICON_BYTES se acepta y MAX_ICON_BYTES + 1 no', () => {
    expect(decodeCanonicalBase64(base64Of(PNG, MAX_ICON_BYTES))?.length).toBe(MAX_ICON_BYTES)
    expect(decodeCanonicalBase64(base64Of(PNG, MAX_ICON_BYTES + 1))).toBeUndefined()
    expect(decodeCanonicalBase64(base64Of(PNG, MAX_ICON_BYTES - 1))?.length).toBe(MAX_ICON_BYTES - 1)
  })
  it('rechaza lo no canónico', () => {
    expect(decodeCanonicalBase64('')).toBeUndefined()
    expect(decodeCanonicalBase64('QQ==')?.length).toBe(1)
    expect(decodeCanonicalBase64('QR==')).toBeUndefined() // bits sobrantes distintos de cero
    expect(decodeCanonicalBase64('QQ')).toBeUndefined() // sin relleno
    expect(decodeCanonicalBase64('QQ=')).toBeUndefined()
    expect(decodeCanonicalBase64('Q-==')).toBeUndefined()
    expect(decodeCanonicalBase64('QQ==\n')).toBeUndefined()
  })
})

describe('matchesMagic e isValidIconImage', () => {
  it('cada mime exige sus propios bytes', () => {
    expect(isValidIconImage('image/png', base64Of(PNG))).toBe(true)
    expect(isValidIconImage('image/jpeg', base64Of(JPEG))).toBe(true)
    expect(isValidIconImage('image/webp', base64Of(WEBP))).toBe(true)
    for (const [mime, bytes] of [
      ['image/png', JPEG],
      ['image/png', WEBP],
      ['image/jpeg', PNG],
      ['image/jpeg', WEBP],
      ['image/webp', PNG],
      ['image/webp', JPEG],
    ] as const) {
      expect(isValidIconImage(mime, base64Of([...bytes], 16))).toBe(false)
    }
  })
  it('las firmas incompletas o con un byte distinto no valen', () => {
    expect(matchesMagic('image/png', new Uint8Array(PNG.slice(0, 7)))).toBe(false)
    expect(matchesMagic('image/png', new Uint8Array([...PNG.slice(0, 7), 0x0b]))).toBe(false)
    expect(matchesMagic('image/jpeg', new Uint8Array([0xff, 0xd8]))).toBe(false)
    expect(matchesMagic('image/webp', new Uint8Array(WEBP.slice(0, 11)))).toBe(false)
    expect(matchesMagic('image/webp', new Uint8Array([...WEBP.slice(0, 11), 0x51]))).toBe(false)
    expect(
      matchesMagic('image/webp', new Uint8Array([0x52, 0x49, 0x46, 0x58, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe(false)
  })
})
