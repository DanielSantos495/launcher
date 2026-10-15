import type { LauncherData } from '@account-launcher/core'
import { MAX_SHARED_DATA_BYTES } from '@account-launcher/protocol'

// Tamaños en bytes UTF-8: los límites del host (ADR-004) se miden así, no en caracteres.
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

export function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value))
}

export interface StoreUsage {
  readonly bytes: number
  readonly limit: number
  readonly ratio: number
  readonly level: 'ok' | 'warn' | 'full'
}

// Cuota de storage.local en Chromium (10 MiB) [Doc].
const LOCAL_QUOTA_BYTES = 10 * 1024 * 1024
// Desde el 80 % se avisa de que se llena; desde el 95 % se dice que está casi lleno.
const WARN_RATIO = 0.8
const FULL_RATIO = 0.95

// Lo que ocupan los datos frente al límite de donde viven: el almacén compartido del host (MAX_SHARED_DATA_BYTES) o la
// cuota de storage.local. Se mide en bytes UTF-8 del JSON, igual que el host (ADR-004).
export function storeUsage(data: LauncherData, source: 'local' | 'shared'): StoreUsage {
  const bytes = jsonBytes(data)
  const limit = source === 'shared' ? MAX_SHARED_DATA_BYTES : LOCAL_QUOTA_BYTES
  const ratio = bytes / limit
  const level = ratio >= FULL_RATIO ? 'full' : ratio >= WARN_RATIO ? 'warn' : 'ok'
  return { bytes, limit, ratio, level }
}
