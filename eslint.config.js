// @ts-check
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['**/node_modules/', '**/coverage/', '**/.output/', '**/.wxt/', 'spike/']),
  js.configs.recommended,
  {
    files: ['packages/**/*.ts', 'apps/**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ['*.ts'],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // core y protocol no tocan la red ni el navegador: cualquier efecto entra por parámetros (los tests quedan fuera).
    files: ['packages/core/**/*.ts', 'packages/protocol/**/*.ts'],
    ignores: ['**/test/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'fetch',
          'XMLHttpRequest',
          'WebSocket',
          'EventSource',
          'chrome',
          'browser',
          'localStorage',
          'sessionStorage',
          'indexedDB',
          'window',
          'document',
        ].map((name) => ({ name, message: 'core y protocol son puros: sin red ni APIs del navegador' })),
      ],
    },
  },
  {
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      // T4: nunca HTML desde datos; React y textContent escapan.
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Prohibido (T4): usa textContent o React.' },
        { property: 'outerHTML', message: 'Prohibido (T4).' },
        { property: 'insertAdjacentHTML', message: 'Prohibido (T4).' },
        { property: 'setHTMLUnsafe', message: 'Prohibido (T4).' },
        { property: 'srcdoc', message: 'Prohibido (T4).' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Prohibido (T4).' },
        { selector: "JSXAttribute[name.name='srcDoc']", message: 'Prohibido (T4).' },
        {
          selector: "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]",
          message: 'Prohibido (T4).',
        },
      ],
    },
  },
])
