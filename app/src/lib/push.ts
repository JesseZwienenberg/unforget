// Turning notifications on for this browser: permission, a push subscription,
// and telling the server about it. Reminder delivery itself is the server's job.
import type { Config } from './storage/types';

/** unsupported: this browser can't; off: not turned on yet; blocked: refused in Android/Chrome settings; on: subscribed. */
export type PushState = 'unsupported' | 'off' | 'blocked' | 'on';

export function pushSupported(): boolean {
  return import.meta.env.PROD && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const bytes = new Uint8Array(a);
  return bytes.length === b.length && bytes.every((v, i) => v === b[i]);
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Browser';
}

async function api(config: Config, path: string, body?: unknown): Promise<Response> {
  return fetch(`${config.api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

/**
 * Subscribes this browser and registers it with the server. Safe to repeat: the
 * app calls it on every start to keep the server's copy fresh. Permission must
 * already be granted.
 */
export async function subscribe(config: Config): Promise<void> {
  const keyRes = await api(config, '/v1/push/key');
  if (!keyRes.ok) throw new Error(keyRes.status === 503 ? 'The server has no push keys yet.' : `The server said ${keyRes.status}.`);
  const key = keyBytes(((await keyRes.json()) as { publicKey: string }).publicKey);

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with another key (after a key rotation) can never be delivered to.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

  const res = await api(config, '/v1/push/subscribe', { ...subscription.toJSON(), label: deviceLabel() });
  if (!res.ok) throw new Error(`The server said ${res.status}.`);
}

export interface TestResult {
  devices: number;
  delivered: number;
  errors: string[];
}

export async function sendTest(config: Config): Promise<TestResult> {
  const res = await api(config, '/v1/push/test', {});
  if (!res.ok) throw new Error(`The server said ${res.status}.`);
  return (await res.json()) as TestResult;
}
