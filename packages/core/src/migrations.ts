import { err, ok, type Result } from './result'
import { SCHEMA_VERSION } from './schema'

// Cada migración convierte la versión n en la n + 1 (§5.4). Hoy solo existe la versión 1.
export type Migration = (input: Record<string, unknown>) => Record<string, unknown>
export const MIGRATIONS: Readonly<Record<number, Migration>> = {}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

export function migrate(
  input: unknown,
  current: number = SCHEMA_VERSION,
  table: Readonly<Record<number, Migration>> = MIGRATIONS,
): Result<Record<string, unknown>, 'unsupported_version' | 'invalid'> {
  if (!isRecord(input)) return err('invalid')
  const version = input.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return err('invalid')
  if (version > current) return err('unsupported_version')
  let out = input
  for (let n = version; n < current; n++) {
    const step = table[n]
    if (step === undefined) return err('invalid')
    out = { ...step(out), schemaVersion: n + 1 }
  }
  return ok(out)
}
