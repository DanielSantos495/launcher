import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EXTENSION_ID } from '../src/extension-id'
import config from '../wxt.config'

// ID que Chrome asigna a una extensión con `key`: los primeros 16 bytes del SHA-256 de la clave pública, con cada
// dígito hexadecimal escrito como una letra de la a a la p.
function idOfKey(key: string): string {
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
  return Array.from(hex, (digit) => String.fromCharCode('a'.charCodeAt(0) + parseInt(digit, 16))).join('')
}

describe('EXTENSION_ID', () => {
  it('es el ID que el navegador deriva de la key del manifest', () => {
    const { manifest } = config
    if (typeof manifest !== 'object' || manifest instanceof Promise || manifest.key === undefined) {
      throw new Error('wxt.config.ts debe declarar manifest.key')
    }
    expect(idOfKey(manifest.key)).toBe(EXTENSION_ID)
  })
})
