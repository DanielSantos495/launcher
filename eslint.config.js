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
    files: ['**/*.js'],
    languageOptions: { globals: { ...globals.node } },
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
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Prohibido (T4).' },
      ],
    },
  },
])
