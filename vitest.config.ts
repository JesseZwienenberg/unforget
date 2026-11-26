import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { $shared: fileURLToPath(new URL('./shared/src', import.meta.url)) } },
  test: {
    include: ['shared/test/**/*.test.ts', 'app/test/**/*.test.ts', 'worker/test/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
