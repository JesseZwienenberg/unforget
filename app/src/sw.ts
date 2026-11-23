/// <reference lib="webworker" />
// Service worker: precaches the whole app shell so the app opens with no network.
// Scope is /unforget/ only; another app lives on the same origin, so every cache
// name carries the "unforget-" prefix and we never touch anything else.
export {};

declare const self: ServiceWorkerGlobalScope;
// Filled in after the build by app/build/precache.ts.
declare const __UF_PRECACHE__: string[];
declare const __UF_VERSION__: string;

const CACHE_PREFIX = 'unforget-shell-';
const CACHE = CACHE_PREFIX + __UF_VERSION__;
const scope = (): string => self.registration.scope;
const shellUrl = (): string => new URL('./', scope()).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: 'reload' skips the HTTP cache, so a new version never precaches stale files.
      await cache.addAll(__UF_PRECACHE__.map((url) => new Request(new URL(url, scope()).href, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(scope())) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Any navigation inside the scope gets the app shell: cache first, no network needed.
      // ignoreVary: some hosts send "Vary: Origin", which would otherwise make the
      // cached copy miss for <script crossorigin> requests and break offline start.
      const options = { ignoreSearch: true, ignoreVary: true };
      const cached =
        request.mode === 'navigate' ? await cache.match(shellUrl(), options) : await cache.match(request, options);
      return cached ?? fetch(request);
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source?.postMessage({ version: __UF_VERSION__ });
});
