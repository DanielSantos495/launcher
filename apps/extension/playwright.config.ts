import { defineConfig } from '@playwright/test'

// E2e de la extensión compilada (.output/chrome-mv3). Un solo worker: cada prueba abre su propio navegador con un
// perfil temporal, pero así el consumo de memoria y la salida quedan predecibles.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
})
