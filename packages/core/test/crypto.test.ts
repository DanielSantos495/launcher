import { describe, expect, it } from 'vitest'
import {
  decryptText,
  encryptText,
  ENCRYPTED_FORMAT,
  isEncryptedText,
  KDF_ITERATIONS,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  PASSWORD_MAX,
  serializeEnvelope,
  type EncryptedEnvelope,
} from '../src/crypto'
import { MAX_IMPORT_BYTES } from '../src/io'

const PASSWORD = 'contraseña-de-prueba'
const PLAIN = '{"hola":"mundo"}'
const fixedRandom = (length: number): Uint8Array => Uint8Array.from({ length }, (_, i) => (length === 16 ? i : 100 + i))
const LOW = MIN_ITERATIONS

// Vector fijo generado con node:crypto (pbkdf2Sync + aes-256-gcm), independiente de esta implementación.
const VECTOR =
  '{"format":"account-launcher-encrypted","v":1,"kdf":{"name":"PBKDF2","hash":"SHA-256","iterations":600000,"salt":"AAECAwQFBgcICQoLDA0ODw=="},"cipher":{"name":"AES-GCM","iv":"ZGVmZ2hpamtsbW5v"},"data":"Eza0kOgUQ5O93DPS9U+o19q/h43QkiNB7PpChJHYjWw="}'

async function seal(iterations = LOW): Promise<EncryptedEnvelope> {
  const sealed = await encryptText(PLAIN, PASSWORD, fixedRandom, iterations)
  if (!sealed.ok) throw new Error('no se pudo cifrar')
  return sealed.value
}

function b64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}
function bytesToB64(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b))
}
function flipByte(s: string, index: number): string {
  const bytes = b64ToBytes(s)
  bytes[index] = (bytes[index] ?? 0) ^ 1
  return bytesToB64(bytes)
}

describe('vector fijo', () => {
  it('cifrar con sal e IV inyectados da exactamente el sobre de referencia', async () => {
    const sealed = await encryptText(PLAIN, PASSWORD, fixedRandom)
    expect(sealed.ok && JSON.stringify(sealed.value)).toBe(VECTOR)
    expect(sealed.ok && sealed.value.kdf.iterations).toBe(KDF_ITERATIONS)
  })

  it('descifra el sobre de referencia', async () => {
    expect(await decryptText(VECTOR, PASSWORD)).toEqual({ ok: true, value: PLAIN })
  })

  it('serializeEnvelope se vuelve a descifrar', async () => {
    const text = serializeEnvelope(await seal())
    expect(await decryptText(text, PASSWORD)).toEqual({ ok: true, value: PLAIN })
  })
})

describe('ida y vuelta', () => {
  it('con aleatoriedad real: dos cifrados difieren y los dos se descifran', async () => {
    const a = await encryptText('héllo ✓ 😀', PASSWORD, undefined, LOW)
    const b = await encryptText('héllo ✓ 😀', PASSWORD, undefined, LOW)
    if (!a.ok || !b.ok) throw new Error('no se pudo cifrar')
    expect(a.value.data).not.toBe(b.value.data)
    expect(a.value.kdf.salt).not.toBe(b.value.kdf.salt)
    expect(await decryptText(JSON.stringify(a.value), PASSWORD)).toEqual({ ok: true, value: 'héllo ✓ 😀' })
  })

  it('texto vacío', async () => {
    const sealed = await encryptText('', PASSWORD, fixedRandom, LOW)
    if (!sealed.ok) throw new Error('no se pudo cifrar')
    expect(await decryptText(JSON.stringify(sealed.value), PASSWORD)).toEqual({ ok: true, value: '' })
  })
})

describe('contraseña', () => {
  it('equivocada: bad_password', async () => {
    expect(await decryptText(JSON.stringify(await seal()), PASSWORD + 'x')).toEqual({
      ok: false,
      error: { code: 'bad_password' },
    })
  })

  it('vacía o de más de PASSWORD_MAX al descifrar: bad_password', async () => {
    const text = JSON.stringify(await seal())
    expect(await decryptText(text, '')).toEqual({ ok: false, error: { code: 'bad_password' } })
    expect(await decryptText(text, 'a'.repeat(PASSWORD_MAX + 1))).toEqual({
      ok: false,
      error: { code: 'bad_password' },
    })
  })

  it('al cifrar: 9 caracteres no valen, 10 sí; 1024 sí, 1025 no (puntos de código)', async () => {
    const code = async (p: string) => {
      const r = await encryptText('x', p, fixedRandom, LOW)
      return r.ok ? 'ok' : r.error.code
    }
    expect(await code('a'.repeat(9))).toBe('invalid_password')
    expect(await code('a'.repeat(10))).toBe('ok')
    expect(await code('😀'.repeat(10))).toBe('ok')
    expect(await code('😀'.repeat(9))).toBe('invalid_password')
    expect(await code('a'.repeat(PASSWORD_MAX))).toBe('ok')
    expect(await code('a'.repeat(PASSWORD_MAX + 1))).toBe('invalid_password')
    expect(await code('a'.repeat(9) + '\ud800')).toBe('invalid_password')
  })
})

describe('alteraciones', () => {
  it.each([0, 5, 15])('un byte de data (%i) da bad_password', async (index) => {
    const e = await seal()
    const text = JSON.stringify({ ...e, data: flipByte(e.data, index) })
    expect(await decryptText(text, PASSWORD)).toEqual({ ok: false, error: { code: 'bad_password' } })
  })

  it('un byte de la etiqueta (el último) da bad_password', async () => {
    const e = await seal()
    const last = b64ToBytes(e.data).length - 1
    const text = JSON.stringify({ ...e, data: flipByte(e.data, last) })
    expect(await decryptText(text, PASSWORD)).toEqual({ ok: false, error: { code: 'bad_password' } })
  })

  it('un byte del iv da bad_password', async () => {
    const e = await seal()
    const text = JSON.stringify({ ...e, cipher: { ...e.cipher, iv: flipByte(e.cipher.iv, 3) } })
    expect(await decryptText(text, PASSWORD)).toEqual({ ok: false, error: { code: 'bad_password' } })
  })

  it('un byte de la sal da bad_password', async () => {
    const e = await seal()
    const text = JSON.stringify({ ...e, kdf: { ...e.kdf, salt: flipByte(e.kdf.salt, 0) } })
    expect(await decryptText(text, PASSWORD)).toEqual({ ok: false, error: { code: 'bad_password' } })
  })

  it('cambiar las iteraciones dentro del rango da bad_password', async () => {
    const e = await seal()
    const text = JSON.stringify({ ...e, kdf: { ...e.kdf, iterations: LOW + 1 } })
    expect(await decryptText(text, PASSWORD)).toEqual({ ok: false, error: { code: 'bad_password' } })
  })

  it('cambios de la cabecera que rompen el esquema dan bad_format', async () => {
    const e = await seal()
    const bad = (mutate: (x: Record<string, unknown>) => void): Promise<unknown> => {
      const copy = JSON.parse(JSON.stringify(e)) as Record<string, unknown>
      mutate(copy)
      return decryptText(JSON.stringify(copy), PASSWORD)
    }
    const fail = { ok: false, error: { code: 'bad_format' } }
    expect(await bad((x) => (x.format = 'otro'))).toEqual(fail)
    expect(await bad((x) => (x.v = 2))).toEqual(fail)
    expect(await bad((x) => ((x.kdf as Record<string, unknown>).name = 'scrypt'))).toEqual(fail)
    expect(await bad((x) => ((x.kdf as Record<string, unknown>).hash = 'SHA-1'))).toEqual(fail)
    expect(await bad((x) => ((x.cipher as Record<string, unknown>).name = 'AES-CBC'))).toEqual(fail)
    expect(await bad((x) => delete x.data)).toEqual(fail)
  })
})

describe('fronteras de iteraciones', () => {
  const withIterations = async (iterations: unknown): Promise<unknown> => {
    const e = await seal()
    return decryptText(JSON.stringify({ ...e, kdf: { ...e.kdf, iterations } }), PASSWORD)
  }
  const fail = { ok: false, error: { code: 'bad_format' } }

  it('99 999 y 2 000 001 son bad_format', async () => {
    expect(await withIterations(MIN_ITERATIONS - 1)).toEqual(fail)
    expect(await withIterations(MAX_ITERATIONS + 1)).toEqual(fail)
  })

  it('no enteros, texto, negativos o ausentes son bad_format', async () => {
    for (const bad of [100_000.5, '100000', -1, null, 1e21, Number.NaN]) {
      expect(await withIterations(bad)).toEqual(fail)
    }
  })

  it('100 000 se acepta (ida y vuelta)', async () => {
    const text = JSON.stringify(await seal(MIN_ITERATIONS))
    expect(await decryptText(text, PASSWORD)).toEqual({ ok: true, value: PLAIN })
  })

  it('2 000 000 pasa el esquema (falla después, en la etiqueta: bad_password)', async () => {
    // Con las iteraciones cambiadas la etiqueta no cuadra: llegar a bad_password prueba que el esquema lo admitió.
    expect(await withIterations(MAX_ITERATIONS)).toEqual({ ok: false, error: { code: 'bad_password' } })
  }, 20_000)

  it('al cifrar, fuera de rango es bad_format', async () => {
    for (const n of [MIN_ITERATIONS - 1, MAX_ITERATIONS + 1, 1.5]) {
      expect(await encryptText('x', PASSWORD, fixedRandom, n)).toEqual({ ok: false, error: { code: 'bad_format' } })
    }
  })
})

describe('validación estricta del sobre', () => {
  const fail = { ok: false, error: { code: 'bad_format' } }
  const clone = async (): Promise<Record<string, Record<string, unknown>>> =>
    JSON.parse(JSON.stringify(await seal())) as Record<string, Record<string, unknown>>

  it('claves de más en cualquier nivel dan bad_format', async () => {
    const top = await clone()
    top.extra = {}
    expect(await decryptText(JSON.stringify(top), PASSWORD)).toEqual(fail)
    const kdf = await clone()
    if (kdf.kdf) kdf.kdf.extra = 1
    expect(await decryptText(JSON.stringify(kdf), PASSWORD)).toEqual(fail)
    const cipher = await clone()
    if (cipher.cipher) cipher.cipher.extra = 1
    expect(await decryptText(JSON.stringify(cipher), PASSWORD)).toEqual(fail)
  })

  it('claves en mayúsculas o __proto__ dan bad_format', async () => {
    const e = await clone()
    const upper = { ...e, Data: e.data }
    expect(await decryptText(JSON.stringify(upper), PASSWORD)).toEqual(fail)
    const text = JSON.stringify(e).replace(/^\{/, '{"__proto__":{},')
    expect(await decryptText(text, PASSWORD)).toEqual(fail)
  })

  it('sal o IV con otra longitud dan bad_format', async () => {
    const e = await seal()
    const salt = (b: Uint8Array) => ({ ...e, kdf: { ...e.kdf, salt: bytesToB64(b) } })
    const iv = (b: Uint8Array) => ({ ...e, cipher: { ...e.cipher, iv: bytesToB64(b) } })
    expect(await decryptText(JSON.stringify(salt(new Uint8Array(15))), PASSWORD)).toEqual(fail)
    expect(await decryptText(JSON.stringify(salt(new Uint8Array(17))), PASSWORD)).toEqual(fail)
    expect(await decryptText(JSON.stringify(iv(new Uint8Array(11))), PASSWORD)).toEqual(fail)
    expect(await decryptText(JSON.stringify(iv(new Uint8Array(13))), PASSWORD)).toEqual(fail)
  })

  it('base64 inválido o no canónico da bad_format', async () => {
    const e = await seal()
    for (const salt of [
      e.kdf.salt.slice(0, -2), // sin relleno
      e.kdf.salt.replace('==', 'AA'), // 'AA' en el relleno
      'AAECAwQFBgcICQoLDA0ODx==', // bits sobrantes distintos de cero
      e.kdf.salt.replace('A', '-'), // alfabeto URL
      ` ${e.kdf.salt}`,
      e.kdf.salt.slice(0, 4) + '\n' + e.kdf.salt.slice(4),
    ]) {
      expect(await decryptText(JSON.stringify({ ...e, kdf: { ...e.kdf, salt } }), PASSWORD)).toEqual(fail)
    }
  })

  it('data más corto que la etiqueta (15 bytes) o vacío da bad_format; con 16 bytes llega a bad_password', async () => {
    const e = await seal()
    const data = (n: number) => JSON.stringify({ ...e, data: bytesToB64(new Uint8Array(n)) })
    expect(await decryptText(data(15), PASSWORD)).toEqual(fail)
    expect(await decryptText(data(0), PASSWORD)).toEqual(fail)
    expect(await decryptText(data(16), PASSWORD)).toEqual({ ok: false, error: { code: 'bad_password' } })
  })

  it('no JSON, arrays, null y números dan bad_format', async () => {
    for (const text of ['', 'no json', '[]', 'null', '7', '"x"']) {
      expect(await decryptText(text, PASSWORD)).toEqual(fail)
    }
  })

  it('más de 5 MB da bad_format antes de parsear', async () => {
    expect(await decryptText(' '.repeat(MAX_IMPORT_BYTES + 1), PASSWORD)).toEqual(fail)
    // Pocos caracteres pero más de 5 MB en UTF-8.
    expect(await decryptText('€'.repeat(Math.ceil(MAX_IMPORT_BYTES / 3) + 1), PASSWORD)).toEqual(fail)
  })

  it('un data enorme (más de lo admitido) da bad_format', async () => {
    const e = await seal()
    const big = 'A'.repeat(Math.ceil((MAX_IMPORT_BYTES + 16) / 3) * 4 + 4)
    expect(await decryptText(JSON.stringify({ ...e, data: big }), PASSWORD)).toEqual(fail)
  })

  it('los errores no repiten valores recibidos', async () => {
    const e = await seal()
    const r = await decryptText(JSON.stringify({ ...e, data: 'SECRETO-NO-BASE64!' }), 'otra-contraseña-larga')
    expect(JSON.stringify(r)).not.toMatch(/SECRETO|otra-contraseña/)
  })
})

describe('isEncryptedText', () => {
  it('detecta solo el sobre', async () => {
    expect(isEncryptedText(JSON.stringify(await seal()))).toBe(true)
    expect(isEncryptedText(`{"format":"${ENCRYPTED_FORMAT}"}`)).toBe(true)
    expect(isEncryptedText('{"app":"account-launcher"}')).toBe(false)
    expect(isEncryptedText('{"format":"otro"}')).toBe(false)
    expect(isEncryptedText('[]')).toBe(false)
    expect(isEncryptedText('no json')).toBe(false)
    expect(isEncryptedText(' '.repeat(MAX_IMPORT_BYTES + 1))).toBe(false)
  })
})
