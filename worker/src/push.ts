// Web Push delivery (VAPID + aes128gcm) with a library built on WebCrypto, so it
// runs on the Workers runtime.
import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { PushPayload } from '../../shared/src/notify';
import type { Env } from './env';

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushResult {
  endpoint: string;
  ok: boolean;
  status: number;
  /** The push service says this subscription no longer exists. */
  gone: boolean;
  error: string | null;
}

/** How long the push service keeps trying when the phone is unreachable. */
export const REMINDER_TTL_SECONDS = 12 * 3600;

export type Sender = (subscription: Subscription, payload: PushPayload, ttlSeconds: number) => Promise<PushResult>;

export function pushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export function createSender(env: Env, fetchFn: typeof fetch = fetch): Sender {
  const vapid = {
    subject: env.VAPID_SUBJECT ?? 'https://jessezwienenberg.github.io/unforget/',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  return async (subscription, payload, ttlSeconds) => {
    const base = { endpoint: subscription.endpoint, ok: false, status: 0, gone: false };
    try {
      const request = await buildPushPayload(
        // Urgency high: wake the phone now, even in Doze.
        { data: { ...payload }, options: { ttl: ttlSeconds, urgency: 'high' } },
        { endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        vapid,
      );
      const res = await fetchFn(subscription.endpoint, { method: request.method, headers: request.headers, body: request.body });
      if (res.ok) return { ...base, ok: true, status: res.status, error: null };
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return { ...base, status: res.status, gone: res.status === 404 || res.status === 410, error: `${res.status} ${detail}`.trim() };
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

export async function listSubscriptions(db: D1Database): Promise<Subscription[]> {
  const { results } = await db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at').all<Subscription>();
  return results;
}

export async function saveSubscription(db: D1Database, sub: Subscription, label: string | null, now: Date): Promise<void> {
  const stamp = now.toISOString();
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at, seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, seen_at = excluded.seen_at`,
    )
    .bind(sub.endpoint, sub.p256dh, sub.auth, label, stamp)
    .run();
}

export async function deleteSubscription(db: D1Database, endpoint: string): Promise<void> {
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(endpoint).run();
}

/** Sends one payload to every subscription and keeps the table honest about the outcome. */
export async function sendToAll(db: D1Database, send: Sender, subs: Subscription[], payload: PushPayload, now: Date): Promise<PushResult[]> {
  const results = await Promise.all(subs.map((s) => send(s, payload, REMINDER_TTL_SECONDS)));
  const stamp = now.toISOString();
  const updates = results.map((r) =>
    r.gone
      ? db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(r.endpoint)
      : r.ok
        ? db.prepare('UPDATE push_subscriptions SET last_ok_at = ?2, last_error = NULL WHERE endpoint = ?1').bind(r.endpoint, stamp)
        : db.prepare('UPDATE push_subscriptions SET last_error = ?2 WHERE endpoint = ?1').bind(r.endpoint, `${stamp} ${r.error ?? 'failed'}`),
  );
  if (updates.length) await db.batch(updates);
  return results;
}
