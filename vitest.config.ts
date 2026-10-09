import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/extension'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src', 'packages/protocol/src', 'apps/extension/src'],
      // src/platform solo envuelve APIs del navegador (se prueba en el navegador real); host-name.ts es lógica pura.
      exclude: ['apps/extension/src/platform/!(host-name).ts'],
      thresholds: {
        // Criterio de aceptación de F1: cobertura de core ≥ 80 %.
        'packages/core/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        // Lógica de la extensión (service worker, almacenamiento, proveedores, capacidades, whoami y utilidades de UI).
        'apps/extension/src/{background,storage,providers,capabilities,whoami}/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'apps/extension/src/ui/lib/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
})
