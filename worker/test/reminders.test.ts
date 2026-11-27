import { beforeEach, describe, expect, it } from 'vitest';
import { createCapture } from '../../shared/src/capture';
import type { PushPayload } from '../../shared/src/notify';
import { DEFAULT_SETTINGS } from '../../shared/src/settings';
import type { Item } from '../../shared/src/types';
import { applyAction } from '../src/actions';
import type { Env } from '../src/env';
import worker from '../src/index';
import { saveSubscription, type PushResult, type Sender } from '../src/push';
import { deliverDueReminders } from '../src/reminders';
import { sync } from '../src/sync';
import { createTestD1, type TestD1 } from './d1';

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const at = (minute: number, hour = 13) => new Date(Date.UTC(2026, 10, 27, hour, minute));
const iso = (minute: number, hour = 13) => at(minute, hour).toISOString();

let db: TestD1;
let sent: { endpoint: string; payload: PushPayload; ttl: number }[];
/** Per-endpoint behaviour of the fake push service. */
let service: Record<string, Partial<PushResult>>;

const send: Sender = async (sub, payload, ttl) => {
  sent.push({ endpoint: sub.endpoint, payload, ttl });
  return { endpoint: sub.endpoint, ok: true, status: 201, gone: false, error: null, ...service[sub.endpoint] };
};

const PHONE = 'https://push.example/phone';
const LAPTOP = 'https://push.example/laptop';

async function subscribe(...endpoints: string[]) {
  for (const endpoint of endpoints) await saveSubscription(db.d1, { endpoint, p256dh: 'p', auth: 'a' }, null, at(0));
}

async function add(text: string, remindAt: string | null, patch: Partial<Item> = {}): Promise<Item> {
  const { capture, item } = createCapture(text, 'typed', at(0), DEFAULT_SETTINGS, newId);
  const full = { ...item, remindAt, ...patch };
  await sync(db.d1, { since: 0, captures: [capture], items: [full], settings: null }, at(0));
  return full;
}

const row = (id: string) => db.raw.prepare('SELECT * FROM items WHERE id = ?').get(id) as Record<string, unknown>;
const run = (minute: number, hour = 13) => deliverDueReminders(db.d1, send, at(minute, hour), DEFAULT_SETTINGS);

beforeEach(() => {
  db = createTestD1();
  sent = [];
  service = {};
});

describe('reminder selection', () => {
  it('sends a reminder when its minute arrives, not before', async () => {
    await subscribe(PHONE);
    const item = await add('p oven uit', iso(10));

    expect((await run(9)).due).toBe(0);
    expect(sent).toEqual([]);

    const report = await run(10);
    expect(report).toMatchObject({ due: 1, sent: 1, late: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ kind: 'reminder', title: 'oven uit', itemId: item.id, body: '⏰ 14:10 · Personal' });
    expect(sent[0]!.ttl).toBe(12 * 3600);
    expect(row(item.id).notified_at).toBe(iso(10));
  });

  it('never sends the same reminder twice', async () => {
    await subscribe(PHONE);
    await add('p once', iso(10));
    await run(10);
    await run(11);
    await run(12);
    expect(sent).toHaveLength(1);
  });

  it('two overlapping runs send it once (the claim is atomic)', async () => {
    await subscribe(PHONE);
    await add('p race', iso(10));
    await Promise.all([run(10), run(10)]);
    expect(sent).toHaveLength(1);
  });

  it('sends to every device', async () => {
    await subscribe(PHONE, LAPTOP);
    await add('p both', iso(10));
    await run(10);
    expect(sent.map((s) => s.endpoint).sort()).toEqual([LAPTOP, PHONE]);
  });

  it('skips done, deleted and undated items', async () => {
    await subscribe(PHONE);
    await add('p done', iso(5), { status: 'done' });
    await add('p deleted', iso(5), { deletedAt: iso(1), updatedAt: iso(1) });
    await add('p undated', null);
    expect((await run(10)).due).toBe(0);
    expect(sent).toEqual([]);
  });

  it('sends several due reminders in time order', async () => {
    await subscribe(PHONE);
    await add('p second', iso(8));
    await add('p first', iso(5));
    await run(10);
    expect(sent.map((s) => s.payload.title)).toEqual(['first', 'second']);
  });
});

describe('late and offline', () => {
  it('a reminder that reaches the server after its time goes out at once, marked late', async () => {
    await subscribe(PHONE);
    await add('p was offline', iso(10)); // captured offline, synced at 13:40
    const report = await run(40);
    expect(report).toMatchObject({ sent: 1, late: 1 });
    expect(sent[0]!.payload.body).toBe('Late · was due 14:10 · Personal');
  });

  it('waits when no device has notifications on, then sends late once one subscribes', async () => {
    const item = await add('p nobody listening', iso(10));
    const report = await run(10);
    expect(report).toMatchObject({ due: 1, sent: 0, noDevices: true });
    expect(row(item.id).notified_at).toBeNull();

    await subscribe(PHONE);
    expect(await run(30)).toMatchObject({ sent: 1, late: 1 });
  });

  it('does not send reminders more than a day old; they stay overdue in the app', async () => {
    await subscribe(PHONE);
    const item = await add('p ancient', '2026-11-25T08:00:00.000Z');
    const report = await run(10);
    expect(report).toMatchObject({ due: 1, sent: 0, skippedStale: 1 });
    expect(sent).toEqual([]);
    expect(row(item.id).notified_at).toBe(iso(10));
    expect(row(item.id).status).toBe('open');
  });

  it('retries next minute when the push service fails, and only then marks it sent', async () => {
    await subscribe(PHONE);
    const item = await add('p flaky', iso(10));
    service[PHONE] = { ok: false, status: 503, error: '503' };
    expect(await run(10)).toMatchObject({ sent: 0, released: 1 });
    expect(row(item.id).notified_at).toBeNull();

    service = {};
    expect(await run(11)).toMatchObject({ sent: 1 });
    expect(row(item.id).notified_at).toBe(iso(11));
    expect(sent).toHaveLength(2);
  });

  it('counts as sent when at least one device got it', async () => {
    await subscribe(PHONE, LAPTOP);
    await add('p partial', iso(10));
    service[LAPTOP] = { ok: false, status: 500, error: '500' };
    expect(await run(10)).toMatchObject({ sent: 1, released: 0 });
  });

  it('forgets a device the push service says is gone', async () => {
    await subscribe(PHONE, LAPTOP);
    await add('p cleanup', iso(10));
    service[LAPTOP] = { ok: false, status: 410, gone: true, error: '410' };
    await run(10);
    expect(db.raw.prepare('SELECT endpoint FROM push_subscriptions').all()).toEqual([{ endpoint: PHONE }]);
  });
});

describe('devices learn about it through sync', () => {
  it('notifiedAt reaches the app on its next sync', async () => {
    await subscribe(PHONE);
    const item = await add('p visible', iso(10));
    const before = await sync(db.d1, { since: 0, captures: [], items: [], settings: null }, at(9));
    await run(10);
    const delta = await sync(db.d1, { since: before.cursor, captures: [], items: [], settings: null }, at(11));
    expect(delta.items).toHaveLength(1);
    expect(delta.items[0]).toMatchObject({ id: item.id, notifiedAt: iso(10) });
  });
});

describe('notification buttons', () => {
  it('Done marks the item done and syncs', async () => {
    const item = await add('p tick me', iso(10));
    const cursor = (await sync(db.d1, { since: 0, captures: [], items: [], settings: null }, at(9))).cursor;
    const result = await applyAction(db.d1, item.id, 'done', at(12), DEFAULT_SETTINGS);
    expect(result).toMatchObject({ ok: true, item: { status: 'done', updatedAt: iso(12), touchedAt: iso(12) } });
    const delta = await sync(db.d1, { since: cursor, captures: [], items: [], settings: null }, at(13));
    expect(delta.items.map((i) => i.status)).toEqual(['done']);
  });

  it('Snooze 1h moves the reminder and re-arms it, so it fires again exactly once', async () => {
    await subscribe(PHONE);
    const item = await add('p snooze me', iso(10));
    await run(10);
    const result = await applyAction(db.d1, item.id, 'snooze:1h', at(12), DEFAULT_SETTINGS);
    expect(result).toMatchObject({ ok: true, item: { remindAt: iso(12, 14), notifiedAt: null, status: 'open' } });

    await run(30); // not yet
    expect(sent).toHaveLength(1);
    await run(12, 14);
    await run(13, 14);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.payload.body).toBe('⏰ 15:12 · Personal');
  });

  it('snooze presets use the settings', async () => {
    const item = await add('p later', iso(10));
    const result = await applyAction(db.d1, item.id, 'snooze:tomorrow-morning', at(12), DEFAULT_SETTINGS);
    expect(result.ok && result.item.remindAt).toBe('2026-11-28T06:45:00.000Z');
  });

  it('a later edit from a device does not undo the snooze re-arm', async () => {
    await subscribe(PHONE);
    const item = await add('p edit after', iso(10));
    await run(10);
    const snoozed = await applyAction(db.d1, item.id, 'snooze:1h', at(12), DEFAULT_SETTINGS);
    if (!snoozed.ok) throw new Error('snooze failed');
    await sync(db.d1, { since: 0, captures: [], items: [{ ...snoozed.item, title: 'renamed', updatedAt: iso(20) }], settings: null }, at(20));
    expect(row(item.id)).toMatchObject({ title: 'renamed', remind_at: iso(12, 14), notified_at: null });
  });

  it('rejects unknown actions and unknown items', async () => {
    const item = await add('p x', iso(10));
    expect(await applyAction(db.d1, item.id, 'explode', at(12), DEFAULT_SETTINGS)).toMatchObject({ ok: false, status: 400 });
    expect(await applyAction(db.d1, newId(), 'done', at(12), DEFAULT_SETTINGS)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('HTTP', () => {
  const env = (extra: Partial<Env> = {}): Env => ({
    DB: db.d1,
    ALLOWED_ORIGINS: 'https://jessezwienenberg.github.io',
    APP_TOKEN: 'tok',
    VAPID_PUBLIC_KEY: 'BPublicKey',
    VAPID_PRIVATE_KEY: 'private',
    ...extra,
  });
  const call = (path: string, method = 'GET', body?: unknown, e = env(), token = 'tok') =>
    worker.fetch(
      new Request(`https://w.example${path}`, { method, headers: { authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }),
      e,
    );

  it('hands out the public key only, and only with the token', async () => {
    expect(await (await call('/v1/push/key')).json()).toEqual({ publicKey: 'BPublicKey' });
    expect((await call('/v1/push/key', 'GET', undefined, env(), 'wrong')).status).toBe(401);
    expect((await call('/v1/push/key', 'GET', undefined, env({ VAPID_PUBLIC_KEY: undefined }))).status).toBe(503);
  });

  it('stores a subscription once, however often the app confirms it', async () => {
    const sub = { endpoint: PHONE, keys: { p256dh: 'p', auth: 'a' }, label: 'Android' };
    expect((await call('/v1/push/subscribe', 'POST', sub)).status).toBe(200);
    expect((await call('/v1/push/subscribe', 'POST', sub)).status).toBe(200);
    expect(db.raw.prepare('SELECT endpoint, label FROM push_subscriptions').all()).toEqual([{ endpoint: PHONE, label: 'Android' }]);

    expect((await call('/v1/push/unsubscribe', 'POST', { endpoint: PHONE })).status).toBe(200);
    expect(db.raw.prepare('SELECT count(*) AS c FROM push_subscriptions').get()).toEqual({ c: 0 });
  });

  it('rejects a malformed subscription', async () => {
    expect((await call('/v1/push/subscribe', 'POST', { endpoint: 'http://insecure.example', keys: { p256dh: 'p', auth: 'a' } })).status).toBe(400);
    expect((await call('/v1/push/subscribe', 'POST', { endpoint: PHONE })).status).toBe(400);
  });

  it('applies a notification button over HTTP', async () => {
    const item = await add('p via http', iso(10));
    const res = await call(`/v1/items/${item.id}/action`, 'POST', { action: 'done' });
    expect(res.status).toBe(200);
    expect(row(item.id).status).toBe('done');
    expect((await call(`/v1/items/${item.id}/action`, 'POST', { action: 'done' }, env(), 'wrong')).status).toBe(401);
    expect((await call('/v1/items/not-a-uuid/action', 'POST', { action: 'done' })).status).toBe(404);
  });

  it('health says whether push is configured', async () => {
    const on = await worker.fetch(new Request('https://w.example/health'), env());
    expect(await on.json()).toMatchObject({ pushConfigured: true, schema: 'm3' });
    const off = await worker.fetch(new Request('https://w.example/health'), env({ VAPID_PRIVATE_KEY: undefined }));
    expect(await off.json()).toMatchObject({ pushConfigured: false });
  });
});
