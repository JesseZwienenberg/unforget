// Service worker registration and install/offline status for the placeholder screen.

export type ShellStatus = 'unsupported' | 'installing' | 'ready' | 'failed';

/** Registers the service worker and resolves once the app shell is cached and controlled. */
export async function registerServiceWorker(onStatus: (s: ShellStatus) => void): Promise<void> {
  if (!('serviceWorker' in navigator)) return onStatus('unsupported');
  if (!import.meta.env.PROD) return onStatus('unsupported'); // no service worker in dev
  onStatus('installing');
  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      type: 'module',
    });
    await navigator.serviceWorker.ready;
    onStatus('ready');
  } catch (err) {
    console.error('service worker registration failed', err);
    onStatus('failed');
  }
}

/** Asks the browser not to evict our local data. Chrome grants this to installed apps. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return null;
  }
}

export function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}
