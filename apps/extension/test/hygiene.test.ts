import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

describe('fuentes', () => {
  // Un BOM literal es invisible en el editor: se escribe siempre como escape.
  it.each(['src/ui/lib/import-export.ts', 'test/ui/import-export.test.ts'])('%s no lleva un BOM literal', (file) => {
    expect(read(file)).not.toContain('﻿')
  })
})

describe('app.css', () => {
  const css = read('src/ui/styles/app.css')

  it('la opción de la vista mide al menos 32 px', () => {
    expect(css).toMatch(/\.segmented__option \{[^}]*min-height: 32px/)
  })

  it('el ancla no queda bajo la cabecera, el desplazamiento no se encadena y el toque no hace zoom', () => {
    expect(css).toMatch(/html \{[^}]*scroll-padding-top:/)
    expect(css).toMatch(/\.dialog \{[^}]*overscroll-behavior: contain/)
    expect(css).toMatch(/button,[^{]*\{[^}]*touch-action: manipulation/)
  })
})
