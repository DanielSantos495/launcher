import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = join(import.meta.dirname, '..', 'src', 'ui', 'styles')
const tokens = readFileSync(join(STYLES, 'tokens.css'), 'utf8')
const app = readFileSync(join(STYLES, 'app.css'), 'utf8')

// Luminancia relativa y contraste según WCAG 2.x.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

// Los tres bloques de tokens: claro (:root), oscuro explícito y oscuro por preferencia del sistema.
function blocks(): string[] {
  return tokens.split(/\n(?=\s*(?::root|@media))/).filter((block) => block.includes('--control-line'))
}

function token(block: string, name: string): string {
  const found = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)
  if (found?.[1] === undefined) throw new Error(`falta ${name}`)
  return found[1]
}

describe('contraste de los bordes de los controles (WCAG 1.4.11)', () => {
  it('hay un valor por tema (claro, oscuro y oscuro del sistema)', () => {
    expect(blocks()).toHaveLength(3)
  })

  it.each([0, 1, 2])('el borde del bloque %i llega a 3:1 sobre la superficie y sobre el fondo', (index) => {
    const block = blocks()[index] ?? ''
    const line = token(block, '--control-line')
    expect(contrast(line, token(block, '--surface'))).toBeGreaterThanOrEqual(3)
    expect(contrast(line, token(block, '--ground'))).toBeGreaterThanOrEqual(3)
  })

  it('botones, campos y selectores usan --control-line', () => {
    for (const selector of ['.button', '.segmented', '.field textarea', '.rows__actions select']) {
      const start = app.indexOf(`\n${selector} {`)
      expect(start, selector).toBeGreaterThan(-1)
      const rule = app.slice(start, app.indexOf('}', start))
      expect(rule, selector).toContain('border: 1px solid var(--control-line)')
    }
  })
})
