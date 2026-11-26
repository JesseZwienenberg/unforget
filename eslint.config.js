import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.wrangler/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    files: ['app/src/**'],
    languageOptions: { globals: { ...globals.browser, __BUILD_ID__: 'readonly' } },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    files: ['scripts/**', 'app/build/**', 'app/test/**', 'app/vite.config.ts', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['app/test/e2e-*.mjs'],
    languageOptions: { globals: globals.browser },
  },
);
