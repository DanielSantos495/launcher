import { err, ok, type Result } from '@account-launcher/core'
import { IconMimeSchema, isValidIconImage, MAX_ICON_BYTES, type IconImage } from '@account-launcher/protocol'
import * as v from 'valibot'

export type ImageFileError = 'invalid' | 'too_large'

const CHUNK = 8192

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

// Lee la imagen elegida. El tamaño se mira antes de leer los bytes; el tipo, la firma y el base64 los vuelve a
// comprobar el service worker, pero aquí se rechazan antes para dar un error claro. Nunca se interpreta como SVG.
export async function readImageFile(file: File): Promise<Result<IconImage, ImageFileError>> {
  if (file.size > MAX_ICON_BYTES) return err('too_large')
  const mime = v.safeParse(IconMimeSchema, file.type)
  if (!mime.success) return err('invalid')
  const base64 = toBase64(new Uint8Array(await file.arrayBuffer()))
  return isValidIconImage(mime.output, base64) ? ok({ mime: mime.output, base64 }) : err('invalid')
}

// URL data: construida solo con el mime de la lista blanca (IconImage ya lo garantiza) y un base64 validado.
export function imageDataUrl(image: IconImage): string {
  return `data:${image.mime};base64,${image.base64}`
}
