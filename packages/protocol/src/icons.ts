import { IconKeySchema, IdSchema } from '@account-launcher/core'
import * as v from 'valibot'
import { IconMimeSchema } from './host'
import { MAX_ICON_BYTES } from './limits'

// Imágenes subidas como icono (T5). Esta validación es la del mensaje de la interfaz; el host repite la suya.

// Longitud máxima del base64 de MAX_ICON_BYTES bytes con relleno (43692 caracteres).
const MAX_BASE64_LENGTH = Math.ceil(MAX_ICON_BYTES / 3) * 4
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

// Clave icon:<id> con un id válido según core: IconKeySchema acepta los nombres reservados (__proto__, constructor,
// prototype) porque cumplen su expresión regular, y aquí no valen.
export const UploadedIconKeySchema = v.pipe(
  IconKeySchema,
  v.check((key) => v.is(IdSchema, key.slice('icon:'.length)), 'clave de icono no válida'),
)

// Bytes de un base64 canónico (relleno completo, alfabeto estándar y bits sobrantes a cero) de como mucho
// MAX_ICON_BYTES, o undefined. El tamaño se comprueba sobre el texto antes de decodificar nada.
export function decodeCanonicalBase64(base64: string): Uint8Array | undefined {
  if (base64.length < 4 || base64.length > MAX_BASE64_LENGTH || !CANONICAL_BASE64.test(base64)) return undefined
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  if ((base64.length / 4) * 3 - padding > MAX_ICON_BYTES) return undefined
  let binary: string
  try {
    binary = atob(base64)
  } catch {
    return undefined
  }
  // Canónico: volver a codificar da exactamente el mismo texto (descarta bits sobrantes distintos de cero).
  if (btoa(binary) !== base64) return undefined
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function startsWith(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  return bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte)
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

// Los bytes mágicos tienen que ser los del tipo declarado: el mime solo no basta.
export function matchesMagic(mime: v.InferOutput<typeof IconMimeSchema>, bytes: Uint8Array): boolean {
  switch (mime) {
    case 'image/png':
      return startsWith(bytes, 0, PNG)
    case 'image/jpeg':
      return startsWith(bytes, 0, JPEG)
    case 'image/webp':
      return startsWith(bytes, 0, RIFF) && startsWith(bytes, 8, WEBP)
  }
}

// Una imagen es válida si su base64 es canónico, no pasa de MAX_ICON_BYTES y sus bytes son del tipo declarado.
export function isValidIconImage(mime: v.InferOutput<typeof IconMimeSchema>, base64: string): boolean {
  const bytes = decodeCanonicalBase64(base64)
  return bytes !== undefined && matchesMagic(mime, bytes)
}

// Imagen guardada o enviada: mime de la lista blanca y base64 validado (también al leer lo guardado).
export const IconImageSchema = v.pipe(
  v.strictObject({ mime: IconMimeSchema, base64: v.pipe(v.string(), v.maxLength(MAX_BASE64_LENGTH)) }),
  v.check((image) => isValidIconImage(image.mime, image.base64), 'imagen no válida'),
)
export type IconImage = v.InferOutput<typeof IconImageSchema>
