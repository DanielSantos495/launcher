// Imágenes mínimas para las pruebas: solo tienen la firma de su tipo, rellenadas con ceros hasta el tamaño pedido.
export type ImageKind = 'png' | 'jpeg' | 'webp'

const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const
const SIGNATURE: Record<ImageKind, readonly number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  // RIFF, tamaño (cualquiera) y WEBP.
  webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function imageBytes(kind: ImageKind, size = 16): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(size))
  bytes.set(SIGNATURE[kind])
  return bytes
}

export function image(kind: ImageKind, size = 16): { mime: string; base64: string } {
  return { mime: MIME[kind], base64: toBase64(imageBytes(kind, size)) }
}

export function pngImage(size = 16): { mime: string; base64: string } {
  return image('png', size)
}
