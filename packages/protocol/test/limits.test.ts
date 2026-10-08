import { BindingsSchema, LIMITS } from '@account-launcher/core'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import * as limits from '../src/limits'

// Los límites son parte del contrato con el host en Go (ADR-004): cualquier cambio debe ser deliberado y llevar
// consigo el cambio en Go. Se fijan con números literales, no con las mismas expresiones que usa limits.ts.
describe('limits (ADR-004)', () => {
  it('fija los diez valores', () => {
    expect({ ...limits }).toEqual({
      PROTOCOL_VERSION: 1,
      MAX_HOST_REQUEST_BYTES: 1_048_576,
      MAX_HOST_RESPONSE_BYTES: 1_000_000,
      MAX_SHARED_DATA_BYTES: 524_288,
      MAX_SHARED_BINDINGS_BYTES: 131_072,
      MAX_ICON_BYTES: 32_768,
      PAIR_CODE_TTL_SECONDS: 120,
      PROOF_TTL_SECONDS: 60,
      DEFAULT_MAX_PAIRED_PROFILES: 2,
      MAX_CONTAINER_NAME: 64,
    })
  })

  // M15: la extensión nunca provoca el too_large de los vínculos. Peor caso realista: 100 vínculos con id de 64
  // caracteres, carpeta de 255 unidades UTF-16 y desiredName de 80, todo con caracteres de 3 bytes en UTF-8 (un
  // carácter de 4 bytes ocupa 2 unidades, así que pesa menos por unidad).
  it('100 vínculos válidos en el peor caso realista caben en MAX_SHARED_BINDINGS_BYTES', () => {
    const bindings = Object.fromEntries(
      Array.from({ length: LIMITS.identities }, (_, n) => [
        `${String(n).padStart(3, '0')}${'x'.repeat(61)}`,
        { kind: 'chromium-profile', profileDirectory: '中'.repeat(255), desiredName: '中'.repeat(LIMITS.label) },
      ]),
    )
    expect(v.safeParse(BindingsSchema, bindings).success).toBe(true)
    const bytes = new TextEncoder().encode(JSON.stringify(bindings)).length
    expect(bytes).toBeGreaterThan(110_000)
    expect(bytes).toBeLessThan(limits.MAX_SHARED_BINDINGS_BYTES)
  })
})
