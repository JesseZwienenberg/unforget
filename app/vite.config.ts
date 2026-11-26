import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { finalizeServiceWorker } from './build/precache.ts';

// The app lives at https://<user>.github.io/unforget/ and shares that origin with
// another app, so everything (assets, manifest, service worker) stays under this path.
const BASE = '/unforget/';

function serviceWorkerPrecache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'unforget-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const { version, urls } = finalizeServiceWorker(outDir);
      console.log(`service worker: precaching ${urls.length} files, version ${version}`);
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [svelte(), serviceWorkerPrecache()],
  resolve: { alias: { $shared: fileURLToPath(new URL('../shared/src', import.meta.url)) } },
  define: {
    __BUILD_ID__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)),
  },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: { main: 'index.html', sw: 'src/sw.ts' },
      output: {
        // The service worker needs a stable URL at the root of the scope.
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
