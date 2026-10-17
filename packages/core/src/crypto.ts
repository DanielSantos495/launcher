import * as v from 'valibot'
import { isRecord } from './guards'
import { MAX_IMPORT_BYTES } from './io'
import { err, ok, type Result } from './result'
import { isWellFormed } from './text'

// Exportación cifrada con contraseña (F1-D, T4): PBKDF2-SHA256 deriva una clave AES-256-GCM. Solo WebCrypto.
// El sobre autentica su cabecera como AAD: cambiar la sal, el IV o las iteraciones invalida la etiqueta.
// Los errores no llevan datos y no distinguen "contraseña equivocada" de "datos alterados" (los dos son bad_password).

export const ENCRYPTED_FORMAT = 'account-launcher-encrypted'
export const KDF_ITERATIONS = 600_000
export const MIN_ITERATIONS = 100_000
export const MAX_ITERATIONS = 2_000_000
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 1024
export const SALT_BYTES = 16
export const IV_BYTES = 12
const TAG_BYTES = 16

// Base64 estándar y canónico: relleno obligatorio, sin saltos de línea.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
// Tope del texto base64 de `data`: el sobre entero cabe en MAX_IMPORT_BYTES (decryptText lo mide antes de parsear),
// así que `data` no puede tener más caracteres que eso. Es una cota derivada, no un valor aparte que mantener.
const MAX_DATA_CHARS = MAX_IMPORT_BYTES

// Los bits sobrantes del último carácter deben ser cero: así cada secuencia de bytes tiene una sola forma escrita.
function isCanonicalBase64(s: string): boolean {
  if (!BASE64.test(s)) return false
  if (s.endsWith('==')) return ALPHABET.indexOf(s.charAt(s.length - 3)) % 16 === 0
  if (s.endsWith('=')) return ALPHABET.indexOf(s.charAt(s.length - 2)) % 4 === 0
  return true
}

function decodeBase64(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

// Texto base64 cuyo contenido decodificado mide exactamente `bytes` (o, con `min`, al menos eso).
// Una sola comprobación: valibot ejecuta todas las acciones de un pipe aunque una anterior falle, y atob lanzaría con
// un texto que no es base64.
const base64 = (maxChars: number, check: (length: number) => boolean) =>
  v.pipe(
    v.string(),
    v.maxLength(maxChars),
    v.check((s) => isCanonicalBase64(s) && check(decodeBase64(s).length)),
  )

export const EncryptedEnvelopeSchema = v.strictObject({
  format: v.literal(ENCRYPTED_FORMAT),
  v: v.literal(1),
  kdf: v.strictObject({
    name: v.literal('PBKDF2'),
    hash: v.literal('SHA-256'),
    iterations: v.pipe(v.number(), v.integer(), v.minValue(MIN_ITERATIONS), v.maxValue(MAX_ITERATIONS)),
    salt: base64(24, (n) => n === SALT_BYTES),
  }),
  cipher: v.strictObject({
    name: v.literal('AES-GCM'),
    iv: base64(16, (n) => n === IV_BYTES),
  }),
  data: base64(MAX_DATA_CHARS, (n) => n >= TAG_BYTES),
})

export type EncryptedEnvelope = v.InferOutput<typeof EncryptedEnvelopeSchema>

export type CryptoErrorCode = 'bad_password' | 'bad_format' | 'invalid_password'

export interface CryptoError {
  readonly code: CryptoErrorCode
}

// Fuente de bytes aleatorios inyectable (las pruebas la fijan). La real usa crypto.getRandomValues.
export type RandomBytes = (length: number) => Uint8Array

export const systemRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length))

// Cabecera canónica: orden de claves fijo, construida desde el sobre ya validado (no desde el texto recibido).
function canonicalHeader(e: EncryptedEnvelope): Uint8Array<ArrayBuffer> {
  const header = {
    format: e.format,
    v: e.v,
    kdf: { name: e.kdf.name, hash: e.kdf.hash, iterations: e.kdf.iterations, salt: e.kdf.salt },
    cipher: { name: e.cipher.name, iv: e.cipher.iv },
  }
  return new TextEncoder().encode(JSON.stringify(header))
}

// Longitud en puntos de código (de la contraseña normalizada a NFC) y sin sustitutos sueltos (que TextEncoder cambiaría por U+FFFD).
export function passwordLength(password: string): number {
  if (!isWellFormed(password)) return -1
  // Se cuenta la forma NFC, la misma con la que se deriva la clave.
  return Array.from(password.normalize('NFC')).length
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

// Cifra `plaintext` en un sobre. La contraseña debe tener de PASSWORD_MIN a PASSWORD_MAX caracteres.
export async function encryptText(
  plaintext: string,
  password: string,
  random: RandomBytes = systemRandom,
  iterations: number = KDF_ITERATIONS,
): Promise<Result<EncryptedEnvelope, CryptoError>> {
  const length = passwordLength(password)
  if (length < PASSWORD_MIN || length > PASSWORD_MAX) return err({ code: 'invalid_password' })
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    return err({ code: 'bad_format' })
  }
  const salt = random(SALT_BYTES)
  const iv = random(IV_BYTES)
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) return err({ code: 'bad_format' })
  const header = {
    format: ENCRYPTED_FORMAT,
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: encodeBase64(salt) },
    cipher: { name: 'AES-GCM', iv: encodeBase64(iv) },
  } as const
  try {
    const key = await deriveKey(password, new Uint8Array(salt), iterations, 'encrypt')
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: canonicalHeader({ ...header, data: '' }) },
      key,
      new TextEncoder().encode(plaintext),
    )
    return ok({ ...header, data: encodeBase64(new Uint8Array(encrypted)) })
  } catch {
    return err({ code: 'bad_format' })
  }
}

// El texto serializado de un sobre, con el mismo orden de claves que la cabecera autenticada.
export function serializeEnvelope(e: EncryptedEnvelope): string {
  return JSON.stringify({ format: e.format, v: e.v, kdf: e.kdf, cipher: e.cipher, data: e.data }, null, 2)
}

// ¿Es un sobre cifrado? Solo mira el campo `format` de un JSON de tamaño admitido; la validación estricta la hace
// decryptText. Va antes del parseo normal de la importación (parseImport diría not_launcher_file).
export function isEncryptedText(text: string): boolean {
  if (text.length > MAX_IMPORT_BYTES) return false
  try {
    const raw: unknown = JSON.parse(text)
    return isRecord(raw) && Object.hasOwn(raw, 'format') && raw.format === ENCRYPTED_FORMAT
  } catch {
    return false
  }
}

// Descifra el texto de un sobre. bad_format: no es un sobre válido; bad_password: la etiqueta GCM no cuadra (contraseña
// equivocada o datos alterados: no se distinguen).
export async function decryptText(text: string, password: string): Promise<Result<string, CryptoError>> {
  // Cada unidad UTF-16 ocupa al menos 1 byte: basta para medir antes de parsear.
  if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return err({ code: 'bad_format' })
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return err({ code: 'bad_format' })
  }
  const parsed = v.safeParse(EncryptedEnvelopeSchema, raw)
  if (!parsed.success) return err({ code: 'bad_format' })
  const envelope = parsed.output
  const length = passwordLength(password)
  if (length < 1 || length > PASSWORD_MAX) return err({ code: 'bad_password' })
  try {
    const key = await deriveKey(password, decodeBase64(envelope.kdf.salt), envelope.kdf.iterations, 'decrypt')
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBase64(envelope.cipher.iv), additionalData: canonicalHeader(envelope) },
      key,
      decodeBase64(envelope.data),
    )
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(plain))
  } catch {
    return err({ code: 'bad_password' })
  }
}
