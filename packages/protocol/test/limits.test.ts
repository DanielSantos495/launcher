import { describe, expect, it } from 'vitest'
import * as limits from '../src/limits'

// Los límites son parte del contrato con el host en Go (ADR-004): cualquier cambio debe ser deliberado y llevar
// consigo el cambio en Go. Se fijan con números literales, no con las mismas expresiones que usa limits.ts.
describe('limits (ADR-004)', () => {
  it('fija los nueve valores', () => {
    expect({ ...limits }).toEqual({
      PROTOCOL_VERSION: 1,
      MAX_HOST_REQUEST_BYTES: 1_048_576,
      MAX_HOST_RESPONSE_BYTES: 1_000_000,
      MAX_SHARED_DATA_BYTES: 524_288,
      MAX_ICON_BYTES: 32_768,
      PAIR_CODE_TTL_SECONDS: 120,
      PROOF_TTL_SECONDS: 60,
      DEFAULT_MAX_PAIRED_PROFILES: 2,
      MAX_CONTAINER_NAME: 64,
    })
  })
})
