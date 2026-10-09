import { CATALOG, IconRefSchema } from '@account-launcher/core'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { bundledIconUrl, GLYPH_ICONS, SERVICE_ICONS } from '../../src/ui/icons'

// Nombre de archivo sin carpeta ni extensión.
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.svg$/, '')
}

// Luminancia relativa WCAG de un color #RRGGBB.
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const serviceFiles = Object.keys(import.meta.glob('../../public/icons/services/*.svg')).map(baseName)
const glyphFiles = Object.keys(import.meta.glob('../../public/icons/glyphs/*.svg')).map(baseName)
const rawSvgs = {
  ...import.meta.glob('../../public/icons/services/*.svg', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../public/icons/glyphs/*.svg', { query: '?raw', import: 'default', eager: true }),
}

describe('iconos empaquetados', () => {
  it('cada servicio del catálogo tiene su archivo', () => {
    for (const service of CATALOG) {
      expect(serviceFiles, service.id).toContain(service.icon)
    }
  })

  it('SERVICE_ICONS coincide exactamente con los archivos de servicios', () => {
    expect([...SERVICE_ICONS].sort()).toEqual([...serviceFiles].sort())
    expect([...SERVICE_ICONS].sort()).toEqual(CATALOG.map((s) => s.icon).sort())
  })

  it('GLYPH_ICONS coincide exactamente con los archivos de glifos', () => {
    expect(GLYPH_ICONS).toHaveLength(12)
    expect([...GLYPH_ICONS].sort()).toEqual([...glyphFiles].sort())
  })

  it('todos los nombres son referencias de icono válidas', () => {
    for (const name of [...SERVICE_ICONS, ...GLYPH_ICONS]) {
      expect(v.safeParse(IconRefSchema, { type: 'bundled', name }).success, name).toBe(true)
    }
  })

  it('bundledIconUrl resuelve servicios y glifos, y rechaza el resto', () => {
    expect(bundledIconUrl('github')).toBe('/icons/services/github.svg')
    expect(bundledIconUrl('folder')).toBe('/icons/glyphs/folder.svg')
    expect(bundledIconUrl('../x')).toBeUndefined()
    expect(bundledIconUrl('')).toBeUndefined()
    expect(bundledIconUrl('constructor')).toBeUndefined()
    expect(bundledIconUrl('__proto__')).toBeUndefined()
  })

  it('ningún SVG lleva scripts ni referencias externas', () => {
    const entries = Object.entries(rawSvgs)
    expect(entries).toHaveLength(SERVICE_ICONS.length + GLYPH_ICONS.length)
    for (const [path, text] of entries) {
      expect(text, path).toContain('viewBox="0 0 24 24"')
      expect(text, path).not.toMatch(/<script/i)
      expect(text, path).not.toMatch(/href=/i)
      expect(text, path).not.toMatch(/url\(/i)
    }
  })

  it('los monogramas de servicio tienen contraste ≥ 4,5:1 con el texto blanco', () => {
    for (const name of SERVICE_ICONS.filter((n) => n !== 'web')) {
      const svg = rawSvgs[`../../public/icons/services/${name}.svg`]
      const fill = /<rect[^>]* fill="(#[0-9A-Fa-f]{6})"/.exec(svg ?? '')?.[1]
      expect(fill, name).toBeDefined()
      expect(1.05 / (luminance(fill ?? '#FFFFFF') + 0.05), name).toBeGreaterThanOrEqual(4.5)
    }
  })
})
