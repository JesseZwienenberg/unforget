import { defineConfig } from 'vitest/config';

// Separate from the normal tests on purpose: this calls the real model and costs (a little) money.
export default defineConfig({
  test: { include: ['evals/**/*.eval.ts'], environment: 'node' },
});
