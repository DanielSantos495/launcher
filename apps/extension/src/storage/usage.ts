// Tamaños en bytes UTF-8: los límites del host (ADR-004) se miden así, no en caracteres.
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

export function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value))
}
