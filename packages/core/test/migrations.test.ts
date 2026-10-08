import { describe, expect, it } from 'vitest'
import { migrate } from '../src/migrations'

describe('migrate', () => {
  it('deja igual la versión actual', () => {
    expect(migrate({ schemaVersion: 1, a: 1 })).toEqual({ ok: true, value: { schemaVersion: 1, a: 1 } })
  })

  it('rechaza versiones futuras y valores no válidos', () => {
    expect(migrate({ schemaVersion: 2 })).toEqual({ ok: false, error: 'unsupported_version' })
    expect(migrate({ schemaVersion: 0 })).toEqual({ ok: false, error: 'invalid' })
    expect(migrate({ schemaVersion: 1.5 })).toEqual({ ok: false, error: 'invalid' })
    expect(migrate({})).toEqual({ ok: false, error: 'invalid' })
    expect(migrate([])).toEqual({ ok: false, error: 'invalid' })
    expect(migrate(null)).toEqual({ ok: false, error: 'invalid' })
  })

  it('aplica la cadena de migraciones en orden', () => {
    const table = {
      1: (x: Record<string, unknown>) => ({ ...x, steps: ['1→2'] }),
      2: (x: Record<string, unknown>) => ({ ...x, steps: [...(x.steps as string[]), '2→3'] }),
    }
    expect(migrate({ schemaVersion: 1 }, 3, table)).toEqual({
      ok: true,
      value: { schemaVersion: 3, steps: ['1→2', '2→3'] },
    })
  })

  it('falla si falta un paso', () => {
    expect(migrate({ schemaVersion: 1 }, 2, {})).toEqual({ ok: false, error: 'invalid' })
  })
})
