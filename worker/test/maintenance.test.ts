import { beforeEach, describe, expect, it } from 'vitest';
import { createCapture } from '../../shared/src/capture';
import type { PushPayload } from '../../shared/src/notify';
import { DEFAULT_SETTINGS } from '../../shared/src/settings';
import type { Item } from '../../shared/src/types';
import type { Env } from '../src/env';
import worker from '../src/index';
import { digestIfDue, nightlyIfDue, runFading } from '../src/maintenance';
import { saveSubscription, type Sender } from '../src/push';
import { sync } from '../src/sync';
import { createTestD1, type TestD1 } from './d1';

const S = DEFAULT_SETTINGS;
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const day = (d: number, hour = 12, minute = 0) => new Date(Date.UTC(2026, 10, d, hour, minute));

let db: TestD1;
let sent: PushPayload[];
let pushOk: boolean;
const send: Sender = async (sub, payload) => {
  sent.push(payload);
  return { endpoint: sub.endpoint, ok: pushOk, status: pushOk ? 201 : 503, gone: false, error: pushOk ? null : '503' };
};

async function add(text: string, madeOn: number, patch: Partial<Item> = {}): Promise<Item> {
  const { capture, item } = createCapture(text, 'typed', day(madeOn), S, newId);
  const full = { ...item, ...patch };
  await sync(db.d1, { since: 0, captures: [capture], items: [full], settings: null }, day(madeOn));
  return full;
}
const statusOf = (id: string) => (db.raw.prepare('SELECT status FROM items WHERE id = ?').get(id) as { status: string }).status;
const subscribe = () => saveSubscription(db.d1, { endpoint: 'https://push.example/phone', p256dh: 'p', auth: 'a' }, null, day(1));

beforeEach(() => {
  db = createTestD1();
  sent = [];
  pushOk = true;
});

describe('nightly clean-up', () => {
  it('archives what has faded, keeps the rest, and deletes nothing', async () => {
    const old = await add('p oud idee', 1);
    const fresh = await add('p nieuw idee', 20);
    const grocery = await add('g melk', 1);
    const overdue = await add('p bellen', 1, { remindAt: day(10).toISOString() });
    const upcoming = await add('p later', 1, { remindAt: day(29).toISOString() });

    expect(await runFading(db.d1, S, day(21))).toBe(2);
    expect([old, fresh, grocery, overdue, upcoming].map((i) => statusOf(i.id))).toEqual(['archived', 'open', 'open', 'archived', 'open']);
    expect(db.raw.prepare('SELECT count(*) AS c FROM items WHERE deleted_at IS NOT NULL').get()).toEqual({ c: 0 });
    expect(db.raw.prepare('SELECT count(*) AS c FROM captures').get()).toEqual({ c: 5 });
  });

  it('devices learn about archived items on their next sync, and the archive wins over their copy', async () => {
    const old = await add('p oud idee', 1);
    const cursor = (await sync(db.d1, { since: 0, captures: [], items: [], settings: null }, day(2))).cursor;
    await runFading(db.d1, S, day(21));
    const delta = await sync(db.d1, { since: cursor, captures: [], items: [], settings: null }, day(21));
    expect(delta.items).toHaveLength(1);
    expect(delta.items[0]).toMatchObject({ id: old.id, status: 'archived' });
    expect(delta.items[0]!.updatedAt > old.updatedAt).toBe(true);
  });

  it('re-adding an archived item brings it back with a fresh clock', async () => {
    const old = await add('p oud idee', 1);
    await runFading(db.d1, S, day(21));
    const stamp = day(22).toISOString();
    await sync(db.d1, { since: 0, captures: [], items: [{ ...old, status: 'open', touchedAt: stamp, updatedAt: stamp }], settings: null }, day(22));
    expect(await runFading(db.d1, S, day(23))).toBe(0);
    expect(statusOf(old.id)).toBe('open');
  });

  it('runs once a night, at or after 03:00 local, even if the cron fires every minute', async () => {
    await add('p oud idee', 1);
    expect(await nightlyIfDue(db.d1, S, day(21, 1, 59))).toBeNull(); // 02:59 local
    expect(await nightlyIfDue(db.d1, S, day(21, 2, 0))).toBe(1); // 03:00
    expect(await nightlyIfDue(db.d1, S, day(21, 2, 1))).toBeNull();
    expect(await nightlyIfDue(db.d1, S, day(21, 15, 0))).toBeNull();
    expect(await nightlyIfDue(db.d1, S, day(22, 2, 7))).toBe(0); // next night, a few minutes late
  });

  it('handles many items', async () => {
    const made = Array.from({ length: 95 }, (_, k) => createCapture(`p idee ${k}`, 'typed', day(1), S, newId));
    await sync(db.d1, { since: 0, captures: made.map((m) => m.capture), items: made.map((m) => m.item), settings: null }, day(1));
    expect(await runFading(db.d1, S, day(21))).toBe(95);
    expect(db.raw.prepare("SELECT count(*) AS c FROM items WHERE status = 'archived'").get()).toEqual({ c: 95 });
  });
});

describe('morning digest', () => {
  const eight = () => new Date('2026-11-27T07:00:00.000Z'); // Friday 08:00 local

  it('is sent once, at the configured time, when there is something to say', async () => {
    await subscribe();
    await add('p garage bellen', 26, { remindAt: '2026-11-27T08:00:00.000Z' });
    expect(await digestIfDue(db.d1, send, S, new Date('2026-11-27T06:59:00.000Z'))).toBe('not-due');
    expect(await digestIfDue(db.d1, send, S, eight())).toBe('sent');
    expect(await digestIfDue(db.d1, send, S, new Date('2026-11-27T07:01:00.000Z'))).toBe('already-sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'digest', title: 'Today: 1 reminder', body: '⏰ 09:00 Garage bellen', tag: 'digest', itemId: null });
  });

  it('is skipped on a quiet day', async () => {
    await subscribe();
    await add('p geen haast', 26);
    expect(await digestIfDue(db.d1, send, S, eight())).toBe('nothing-to-say');
    expect(sent).toEqual([]);
  });

  it('tries again the next minute when the push fails', async () => {
    await subscribe();
    await add('w rapport', 26, { dueAt: '2026-11-27' });
    pushOk = false;
    expect(await digestIfDue(db.d1, send, S, eight())).toBe('failed');
    pushOk = true;
    expect(await digestIfDue(db.d1, send, S, new Date('2026-11-27T07:01:00.000Z'))).toBe('sent');
    expect(sent).toHaveLength(2);
  });

  it('comes again the next day', async () => {
    await subscribe();
    await add('p elke dag', 20, { remindAt: '2026-11-21T08:00:00.000Z' }); // overdue all week
    await digestIfDue(db.d1, send, S, eight());
    expect(await digestIfDue(db.d1, send, S, new Date('2026-11-28T07:00:00.000Z'))).toBe('sent');
    expect(sent).toHaveLength(2);
  });

  it('does nothing without a subscribed device', async () => {
    await add('p garage bellen', 26, { remindAt: '2026-11-27T08:00:00.000Z' });
    expect(await digestIfDue(db.d1, send, S, eight())).toBe('no-devices');
  });
});

describe('POST /v1/cleanup', () => {
  const env = (): Env => ({ DB: db.d1, ALLOWED_ORIGINS: 'https://jessezwienenberg.github.io', APP_TOKEN: 'tok' });
  const call = (token = 'tok') => worker.fetch(new Request('https://w.example/v1/cleanup', { method: 'POST', headers: { authorization: `Bearer ${token}` } }), env());

  it('runs the clean-up now, with the stored settings', async () => {
    const old = await add('p recent', 1);
    // Fading for Personal set to 0 days: everything undated fades at once.
    const zero = { ...S, fading: { ...S.fading, personalDays: 0 } };
    await sync(db.d1, { since: 0, captures: [], items: [], settings: { value: zero, updatedAt: day(2).toISOString() } }, day(2));
    const res = await call();
    expect(await res.json()).toEqual({ archived: 1 });
    expect(statusOf(old.id)).toBe('archived');
    expect((await call('wrong')).status).toBe(401);
  });
});
