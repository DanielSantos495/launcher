import { configDefaults, defineProject } from 'vitest/config'

export default defineProject({
  // Las pruebas de UI declaran `// @vitest-environment happy-dom` en su primera línea; el resto corre en node.
  // e2e/ son pruebas de Playwright (pnpm e2e): vitest no debe recogerlas.
  test: { name: 'extension', exclude: [...configDefaults.exclude, 'e2e/**'] },
  oxc: { jsx: { runtime: 'automatic' } },
})
