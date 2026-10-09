import { defineProject } from 'vitest/config'

export default defineProject({
  // Las pruebas de UI declaran `// @vitest-environment happy-dom` en su primera línea; el resto corre en node.
  test: { name: 'extension' },
  oxc: { jsx: { runtime: 'automatic' } },
})
