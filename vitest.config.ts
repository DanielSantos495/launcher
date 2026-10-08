import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src', 'packages/protocol/src'],
      thresholds: {
        // Criterio de aceptación de F1: cobertura de core ≥ 80 %.
        'packages/core/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
})
