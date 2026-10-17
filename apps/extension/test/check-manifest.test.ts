import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'check-manifest.mjs')
const dir = mkdtempSync(join(tmpdir(), 'check-manifest-'))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

// Ejecuta el script contra un manifest con ese texto y devuelve el código de salida y lo que escribió.
function run(text: string): { status: number | null; out: string } {
  const file = join(dir, 'manifest.json')
  writeFileSync(file, text)
  const result = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' })
  return { status: result.status, out: result.stdout + result.stderr }
}

const VALID = { permissions: ['storage', 'nativeMessaging'], key: 'abc', default_locale: 'es' }

describe('check-manifest', () => {
  it('acepta un manifest con solo storage y nativeMessaging', () => {
    expect(run(JSON.stringify(VALID))).toEqual({ status: 0, out: 'check-manifest: ok\n' })
  })

  it('rechaza un permiso de más', () => {
    const result = run(JSON.stringify({ ...VALID, permissions: ['storage', 'nativeMessaging', 'tabs'] }))
    expect(result.status).toBe(1)
    expect(result.out).toContain('permissions debe ser exactamente')
  })

  it('rechaza un campo prohibido', () => {
    const result = run(JSON.stringify({ ...VALID, host_permissions: ['<all_urls>'] }))
    expect(result.status).toBe(1)
    expect(result.out).toContain('no debe existir host_permissions')
  })

  it('rechaza un archivo que no se puede leer como JSON', () => {
    const result = run('no es json')
    expect(result.status).toBe(1)
    expect(result.out).toContain('no se pudo leer')
  })

  it.each(['null', '[]', '5', '"texto"'])('un manifest que no es un objeto (%s) sale con un mensaje limpio', (text) => {
    const result = run(text)
    expect(result.status).toBe(1)
    expect(result.out).toBe(`check-manifest: el manifest debe ser un objeto\n`)
  })
})
