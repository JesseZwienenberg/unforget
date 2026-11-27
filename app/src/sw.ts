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

// ---- notifications ---------------------------------------------------------

interface PushData {
  kind: string;
  title: string;
  body: string;
  tag: string;
  itemId: string | null;
  actions: { action: string; title: string }[];
}

interface NoteData {
  kind: string;
  itemId: string | null;
  actions: PushData['actions'];
}

function show(title: string, body: string, tag: string, data: NoteData): Promise<void> {
  // `actions` and `renotify` are not in TypeScript's NotificationOptions yet.
  const options = {
    body,
    tag,
    renotify: true,
    data,
    actions: data.actions,
    icon: new URL('icons/icon-192.png', scope()).href,
    badge: new URL('icons/badge.png', scope()).href,
  } as NotificationOptions;
  return self.registration.showNotification(title, options);
}

self.addEventListener('push', (event) => {
  let push: PushData | null;
  try {
    push = (event.data?.json() as PushData | undefined) ?? null;
  } catch {
    push = null;
  }
  // Chrome requires that every push shows something, so there is always a fallback.
  const p = push ?? { kind: 'reminder', title: 'Unforget', body: 'You have a reminder.', tag: 'unknown', itemId: null, actions: [] };
  event.waitUntil(show(p.title, p.body, p.tag, { kind: p.kind, itemId: p.itemId, actions: p.actions ?? [] }));
});

/** Reads the API address and token the app saved. Plain IndexedDB: no library in the worker. */
async function readConfig(): Promise<{ api: string; token: string } | null> {
  const existing = await indexedDB.databases();
  if (!existing.some((d) => d.name === 'unforget')) return null;
  return new Promise((resolve) => {
    const open = indexedDB.open('unforget');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const get = db.transaction('kv', 'readonly').objectStore('kv').get('config');
        get.onsuccess = () => {
          db.close();
          resolve((get.result?.value as { api: string; token: string } | undefined) ?? null);
        };
        get.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}

async function appWindows(): Promise<WindowClient[]> {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return all.filter((c) => c.url.startsWith(scope()));
}

/** Opens the app (or brings it forward) and, for a reminder, asks it to show the snooze sheet. */
async function openApp(itemId: string | null): Promise<void> {
  const [client] = await appWindows();
  if (client) {
    await client.focus().catch(() => undefined);
    client.postMessage({ type: 'open-item', itemId });
    return;
  }
  await self.clients.openWindow(itemId ? `${scope()}?item=${encodeURIComponent(itemId)}` : scope());
}

/** A button on the notification: tell the server, without opening the app. Never fails silently. */
async function act(note: Notification, action: string): Promise<void> {
  const data = note.data as NoteData;
  const config = await readConfig();
  let failure = '';
  if (!config || !data.itemId) {
    failure = 'This device is not connected.';
  } else {
    try {
      const res = await fetch(`${config.api}/v1/items/${data.itemId}/action`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) failure = res.status === 404 ? 'That item no longer exists.' : `The server said ${res.status}.`;
    } catch {
      failure = 'No connection.';
    }
  }
  if (failure) {
    // Put the reminder back with the reason, so it is not lost.
    await show(note.title, `Not saved: ${failure} Tap to open Unforget.`, note.tag, data);
    return;
  }
  for (const client of await appWindows()) client.postMessage({ type: 'sync' });
}

self.addEventListener('notificationclick', (event) => {
  const note = event.notification;
  note.close();
  const data = (note.data ?? { kind: 'reminder', itemId: null, actions: [] }) as NoteData;
  event.waitUntil(event.action ? act(note, event.action) : openApp(data.kind === 'reminder' ? data.itemId : null));
});

// The browser replaced our subscription (rare): subscribe again and tell the server.
self.addEventListener('pushsubscriptionchange', (event) => {
  const change = event as ExtendableEvent & { oldSubscription?: PushSubscription | null };
  change.waitUntil(
    (async () => {
      const config = await readConfig();
      const options = change.oldSubscription?.options;
      if (!config || !options?.applicationServerKey) return;
      const fresh = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: options.applicationServerKey });
      await fetch(`${config.api}/v1/push/subscribe`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(fresh.toJSON()),
      });
    })().catch(() => undefined),
  );
});
