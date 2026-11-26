import { beforeEach, describe, expect, it } from 'vitest';
import { createCapture } from '../../shared/src/capture';
import { DEFAULT_SETTINGS } from '../../shared/src/settings';
import type { Capture, Item, SyncRequest, SyncResponse } from '../../shared/src/types';
import type { Env } from '../src/env';
import worker from '../src/index';
import { sync } from '../src/sync';
import { createTestD1, type TestD1 } from './d1';

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const at = (minute: number) => new Date(Date.UTC(2026, 10, 26, 13, minute)).toISOString();
const NOW = new Date(at(30));

function make(text: string, minute = 0): { capture: Capture; item: Item } {
  return createCapture(text, 'typed', new Date(at(minute)), DEFAULT_SETTINGS, newId);
}

let db: TestD1;
beforeEach(() => {
  db = createTestD1();
});

const push = (req: Partial<SyncRequest>): Promise<SyncResponse> =>
  sync(db.d1, { since: 0, captures: [], items: [], settings: null, ...req }, NOW);

describe('sync', () => {
  it('stores what a device sends and returns it to another device', async () => {
    const a = make('over 10 minuten oven uit');
    const first = await push({ captures: [a.capture], items: [a.item] });
    expect(first.cursor).toBe(2);
    expect(first.more).toBe(false);

    const other = await push({});
    expect(other.captures).toEqual([a.capture]);
    expect(other.items).toEqual([a.item]);
  });

  it('returns only what changed since the cursor', async () => {
    const a = make('p one');
    const r1 = await push({ captures: [a.capture], items: [a.item] });
    const b = make('p two', 1);
    await push({ captures: [b.capture], items: [b.item] });

    const delta = await push({ since: r1.cursor });
    expect(delta.items.map((i) => i.title)).toEqual(['two']);
    expect(delta.captures.map((c) => c.id)).toEqual([b.capture.id]);

    const nothing = await push({ since: delta.cursor });
    expect(nothing.items).toEqual([]);
    expect(nothing.cursor).toBe(delta.cursor);
  });

  it('is idempotent: sending the same rows twice changes nothing', async () => {
    const a = make('p one');
    const r1 = await push({ captures: [a.capture], items: [a.item] });
    await push({ captures: [a.capture], items: [a.item] });
    const delta = await push({ since: r1.cursor });
    expect(delta.items).toEqual([]);
    expect(delta.captures).toEqual([]);
    expect(db.raw.prepare('SELECT count(*) AS c FROM items').get()).toEqual({ c: 1 });
  });

  it('last write wins, whatever order the writes arrive in', async () => {
    const a = make('p draft');
    await push({ items: [a.item] });
    const newer = { ...a.item, title: 'newer', updatedAt: at(10) };
    const older = { ...a.item, title: 'older', updatedAt: at(5) };

    await push({ items: [newer] });
    await push({ items: [older] }); // arrives late, from a device that was offline
    const all = await push({});
    expect(all.items[0]!.title).toBe('newer');
  });

  it('syncs soft deletes', async () => {
    const a = make('p oops');
    await push({ captures: [a.capture], items: [a.item] });
    await push({
      captures: [{ ...a.capture, deletedAt: at(2), updatedAt: at(2) }],
      items: [{ ...a.item, deletedAt: at(2), updatedAt: at(2) }],
    });
    const all = await push({});
    expect(all.items[0]!.deletedAt).toBe(at(2));
    expect(all.captures[0]!.deletedAt).toBe(at(2));
    expect(all.captures[0]!.text).toBe('p oops'); // the raw text stays
  });

  it('keeps the raw capture text and the server-owned sort status on update', async () => {
    const a = make('p original');
    await push({ captures: [a.capture] });
    db.raw.exec("UPDATE captures SET sort_status = 'sorted'");
    await push({ captures: [{ ...a.capture, text: 'tampered', updatedAt: at(3) }] });
    const all = await push({});
    expect(all.captures[0]).toMatchObject({ text: 'p original', sortStatus: 'sorted' });
  });

  it('keeps notifiedAt through an edit, so a reminder is never sent twice', async () => {
    const a = make('in 10 min thee');
    await push({ items: [a.item] });
    db.raw.prepare('UPDATE items SET notified_at = ?').run(at(10));

    await push({ items: [{ ...a.item, title: 'thee zetten', updatedAt: at(12) }] });
    const all = await push({});
    expect(all.items[0]).toMatchObject({ title: 'thee zetten', notifiedAt: at(10) });
  });

  it('clears notifiedAt when the reminder time changes (snooze)', async () => {
    const a = make('in 10 min thee');
    await push({ items: [a.item] });
    db.raw.prepare('UPDATE items SET notified_at = ?').run(at(10));

    await push({ items: [{ ...a.item, remindAt: at(70), updatedAt: at(12) }] });
    const all = await push({});
    expect(all.items[0]).toMatchObject({ remindAt: at(70), notifiedAt: null });
  });

  it('round-trips grocery fields, flags and deadlines', async () => {
    const a = make('g melk');
    const item: Item = {
      ...a.item,
      grocery: { canonicalName: 'milk', displayName: 'melk', quantity: 2, section: 'Dairy & eggs' },
      unsorted: true,
      provisional: false,
      dueAt: '2026-11-28',
    };
    await push({ items: [item] });
    expect((await push({})).items[0]).toEqual(item);
  });

  it('syncs settings with last write wins', async () => {
    expect((await push({})).settings).toBeNull();
    const mine = { ...DEFAULT_SETTINGS, timeZone: 'UTC' };
    const r1 = await push({ settings: { value: mine, updatedAt: at(1) } });
    expect(r1.settings).toEqual({ value: mine, updatedAt: at(1) });

    await push({ settings: { value: DEFAULT_SETTINGS, updatedAt: at(0) } }); // older: ignored
    expect((await push({})).settings!.value.timeZone).toBe('UTC');
    expect((await push({ since: r1.cursor })).settings).toBeNull();
  });

  it('pages large histories without losing or repeating rows', async () => {
    const made = Array.from({ length: 23 }, (_, i) => make(`p item ${i}`, i));
    await push({ captures: made.map((m) => m.capture), items: made.map((m) => m.item) });
    await push({ settings: { value: DEFAULT_SETTINGS, updatedAt: at(1) } });

    const seenItems: string[] = [];
    const seenCaptures: string[] = [];
    let since = 0;
    let pages = 0;
    let sawSettings = 0;
    for (;;) {
      const page = await sync(db.d1, { since, captures: [], items: [], settings: null }, NOW, 5);
      seenItems.push(...page.items.map((i) => i.id));
      seenCaptures.push(...page.captures.map((c) => c.id));
      if (page.settings) sawSettings++;
      since = page.cursor;
      pages++;
      if (!page.more) break;
      expect(pages).toBeLessThan(50);
    }
    expect(pages).toBeGreaterThan(4);
    expect(seenItems.sort()).toEqual(made.map((m) => m.item.id).sort());
    expect(seenCaptures.sort()).toEqual(made.map((m) => m.capture.id).sort());
    expect(sawSettings).toBe(1);
  });

  it('gives every written row its own rev', async () => {
    const made = Array.from({ length: 4 }, (_, i) => make(`p ${i}`));
    await push({ captures: made.map((m) => m.capture), items: made.map((m) => m.item), settings: { value: DEFAULT_SETTINGS, updatedAt: at(0) } });
    const revs = db.raw
      .prepare('SELECT rev FROM captures UNION ALL SELECT rev FROM items UNION ALL SELECT rev FROM settings')
      .all()
      .map((r) => r.rev as number)
      .sort((x, y) => x - y);
    expect(revs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('POST /v1/sync', () => {
  const env = (): Env => ({ DB: db.d1, ALLOWED_ORIGINS: 'https://jessezwienenberg.github.io', APP_TOKEN: 'tok' });
  const post = (body: string, token = 'tok') =>
    worker.fetch(
      new Request('https://w.example/v1/sync', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body }),
      env(),
    );

  it('needs the token', async () => {
    expect((await post('{}', 'wrong')).status).toBe(401);
  });

  it('syncs over HTTP', async () => {
    const a = make('w in 2 hours demo');
    const res = await post(JSON.stringify({ since: 0, captures: [a.capture], items: [a.item] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncResponse;
    expect(body.items[0]).toMatchObject({ list: 'work', title: 'demo' });
  });

  it('rejects bad input with 400 and stores nothing', async () => {
    expect((await post('not json')).status).toBe(400);
    const a = make('p x');
    const res = await post(JSON.stringify({ items: [{ ...a.item, list: 'inbox' }] }));
    expect(res.status).toBe(400);
    expect(db.raw.prepare('SELECT count(*) AS c FROM items').get()).toEqual({ c: 0 });
  });

  it('health reports the m1 schema', async () => {
    const res = await worker.fetch(new Request('https://w.example/health'), env());
    expect(await res.json()).toMatchObject({ ok: true, schema: 'm1' });
  });
});
