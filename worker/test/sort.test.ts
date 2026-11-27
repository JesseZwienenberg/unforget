import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapture } from '../../shared/src/capture';
import { DEFAULT_SETTINGS } from '../../shared/src/settings';
import type { Item, SyncResponse } from '../../shared/src/types';
import type { Env } from '../src/env';
import worker from '../src/index';
import { derivedId, MAX_ATTEMPTS, settle, sortCapture, sortPending, type SortDeps } from '../src/sort/apply';
import type { Sorter } from '../src/sort/llm';
import { extractToolInput, InvalidOutput, parseModelTime, parseSortOutput, type SortedItem } from '../src/sort/output';
import { buildRequest, buildUserMessage, toLocalIso, type PromptInput } from '../src/sort/prompt';
import { sync } from '../src/sync';
import { createTestD1, type TestD1 } from './d1';

const S = DEFAULT_SETTINGS;
const fixtures = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'llm', 'outputs.json'), 'utf8')) as {
  valid: { name: string; output: unknown; expected: SortedItem[] }[];
  invalid: { name: string; output: unknown }[];
};

describe('model output validation (fixtures)', () => {
  it.each(fixtures.valid)('accepts: $name', ({ output, expected }) => {
    expect(parseSortOutput(output, S)).toEqual(expected);
  });
  it.each(fixtures.invalid)('rejects: $name', ({ output }) => {
    expect(() => parseSortOutput(output, S)).toThrow(InvalidOutput);
  });

  it('reads the wall clock in the user zone on both sides of each clock change', () => {
    expect(parseModelTime('2026-03-28T07:45:00+01:00', S.timeZone)).toBe('2026-03-28T06:45:00.000Z');
    expect(parseModelTime('2026-03-29T07:45:00+01:00', S.timeZone)).toBe('2026-03-29T05:45:00.000Z');
    expect(parseModelTime('2026-10-24T07:45:00+02:00', S.timeZone)).toBe('2026-10-24T05:45:00.000Z');
    expect(parseModelTime('2026-10-25T07:45:00+02:00', S.timeZone)).toBe('2026-10-25T06:45:00.000Z');
  });

  it('finds the forced tool call in an API response', () => {
    const response = { content: [{ type: 'tool_use', id: 't', name: 'file_items', input: { items: [] } }] };
    expect(extractToolInput(response, 'file_items')).toEqual({ items: [] });
    expect(() => extractToolInput({ content: [{ type: 'text', text: 'hi' }] }, 'file_items')).toThrow(InvalidOutput);
    expect(() => extractToolInput({ error: 'x' }, 'file_items')).toThrow(InvalidOutput);
  });
});

describe('prompt', () => {
  const input: PromptInput = {
    text: 'morgenochtend tandarts bellen',
    capturedAt: new Date('2026-11-26T13:03:20.000Z'),
    settings: S,
    fixedList: null,
    deviceRemindAt: null,
  };

  it('gives the model the local date, a calendar, the settings and the capture', () => {
    const message = buildUserMessage(input);
    expect(message).toContain('Capture time: Thursday 2026-11-26, 14:03 (Europe/Amsterdam, offset +01:00)');
    expect(message).toContain('Friday 2026-11-27 (tomorrow)');
    expect(message).toContain('Monday 2026-11-30');
    expect(message).toContain('Thursday 2026-12-10');
    expect(message).toContain('Vague times: morning 07:45, afternoon 13:00, evening 20:00, weekend Saturday 10:00');
    expect(message).toContain('Grocery sections: Fruit & vegetables | Bread & bakery');
    expect(message).toContain('Fixed list: none');
    expect(message).toContain('Device reminder: none');
    expect(message).toContain('<capture>\nmorgenochtend tandarts bellen\n</capture>');
  });

  it('uses the summer offset in summer, and passes on a prefix and the device reminder', () => {
    const message = buildUserMessage({ ...input, capturedAt: new Date('2026-07-01T10:00:00.000Z'), fixedList: 'work', deviceRemindAt: '2026-07-01T10:10:00.000Z' });
    expect(message).toContain('Wednesday 2026-07-01, 12:00 (Europe/Amsterdam, offset +02:00)');
    expect(message).toContain('Fixed list: work');
    expect(message).toContain('Device reminder: 2026-07-01T12:10:00+02:00');
  });

  it('writes local times with the right offset', () => {
    expect(toLocalIso(new Date('2026-11-26T13:13:00.000Z'), S.timeZone)).toBe('2026-11-26T14:13:00+01:00');
    expect(toLocalIso(new Date('2026-03-29T01:30:00.000Z'), S.timeZone)).toBe('2026-03-29T03:30:00+02:00');
  });

  it('forces the tool, names the model, and sends no sampling parameters', () => {
    const request = buildRequest(input);
    expect(request.model).toBe('claude-haiku-5-5');
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'file_items' });
    expect(request).not.toHaveProperty('temperature');
    expect(JSON.stringify(request.system)).toContain('melk, brood en 6 eieren');
  });
});

describe('settle', () => {
  const base: SortedItem = { title: 'x', list: 'work', remindAt: null, dueAt: null, grocery: null, confidence: 0.9 };

  it('a prefix overrides the model for every item', () => {
    const out = settle([base, { ...base, list: 'personal' }], 'groceries', null, S);
    expect(out.map((i) => i.list)).toEqual(['groceries', 'groceries']);
    expect(out[0]!.grocery).toEqual({ canonicalName: 'x', displayName: 'x', quantity: null, section: 'Other' });
  });

  it('low confidence goes to Personal, marked unsorted', () => {
    expect(settle([{ ...base, confidence: 0.4 }], null, null, S)[0]).toMatchObject({ list: 'personal', unsorted: true });
    expect(settle([{ ...base, confidence: 0.6 }], null, null, S)[0]).toMatchObject({ list: 'work', unsorted: false });
  });

  it('low confidence never overrides a prefix', () => {
    expect(settle([{ ...base, confidence: 0.1 }], 'work', null, S)[0]).toMatchObject({ list: 'work', unsorted: false });
  });

  it('keeps the exact time the phone computed', () => {
    const device = '2026-11-26T13:13:00.000Z';
    expect(settle([{ ...base, remindAt: '2026-11-26T13:14:00.000Z' }], null, device, S)[0]!.remindAt).toBe(device);
    expect(settle([{ ...base }], null, device, S)[0]!.remindAt).toBe(device);
    const two = settle([{ ...base, remindAt: '2026-11-26T13:14:00.000Z' }, { ...base, remindAt: '2026-11-27T06:45:00.000Z' }], null, device, S);
    expect(two.map((i) => i.remindAt)).toEqual([device, '2026-11-27T06:45:00.000Z']);
  });
});

// ---- the full path against a real SQLite database -------------------------------

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const at = (minute: number, hour = 13) => new Date(Date.UTC(2026, 10, 26, hour, minute));
let db: TestD1;
let calls: PromptInput[];
let answer: (input: PromptInput) => unknown;

const sorter: Sorter = async (input) => {
  calls.push(input);
  return answer(input);
};
const deps = (minute = 4, settings = S): SortDeps => ({ db: db.d1, sorter, settings, now: at(minute) });
const out = (...items: Partial<SortedItem>[]) => ({
  items: items.map((i) => ({ title: 'x', list: 'personal', remindAt: null, dueAt: null, grocery: null, confidence: 0.9, ...i })),
});
const groc = (canonicalName: string, displayName: string, quantity: number | null = null, section = 'Dairy & eggs') => ({
  title: displayName,
  list: 'groceries' as const,
  grocery: { canonicalName, displayName, quantity, section },
});

async function captureText(text: string, minute = 3) {
  const made = createCapture(text, 'typed', at(minute), S, newId);
  await sync(db.d1, { since: 0, captures: [made.capture], items: [made.item], settings: null }, at(minute));
  return made;
}
const allItems = async (): Promise<Item[]> => (await sync(db.d1, { since: 0, captures: [], items: [], settings: null }, at(30))).items;
const live = async () => (await allItems()).filter((i) => !i.deletedAt);
const captureRow = (id: string) => db.raw.prepare('SELECT * FROM captures WHERE id = ?').get(id) as Record<string, unknown>;

beforeEach(() => {
  db = createTestD1();
  calls = [];
  answer = () => out({ title: 'sorted', list: 'work' });
});

describe('sortCapture', () => {
  it('replaces the provisional item in place and marks the capture sorted', async () => {
    const { capture, item } = await captureText('kwartaalcijfers nakijken');
    expect(await sortCapture(deps(), capture.id, 1000)).toBe('sorted');
    const items = await live();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: item.id, title: 'sorted', list: 'work', provisional: false, unsorted: false, captureId: capture.id });
    expect(captureRow(capture.id)).toMatchObject({ sort_status: 'sorted', text: 'kwartaalcijfers nakijken' });
    expect(calls[0]).toMatchObject({ text: 'kwartaalcijfers nakijken', fixedList: null, deviceRemindAt: null });
  });

  it('splits one capture into several items with ids that are the same on a retry', async () => {
    const { capture, item } = await captureText('melk, brood en bel de tandarts morgen');
    answer = () => out(groc('milk', 'melk'), groc('bread', 'brood', null, 'Bread & bakery'), { title: 'bel de tandarts', remindAt: '2026-11-27T07:45:00+01:00' });
    await sortCapture(deps(), capture.id, 1000);
    const items = await live();
    expect(items.map((i) => i.title).sort()).toEqual(['bel de tandarts', 'brood', 'melk']);
    expect(items.find((i) => i.title === 'melk')!.id).toBe(item.id);
    expect(items.find((i) => i.title === 'brood')!.id).toBe(await derivedId(capture.id, 1));
    expect(items.find((i) => i.title === 'bel de tandarts')).toMatchObject({ id: await derivedId(capture.id, 2), remindAt: '2026-11-27T06:45:00.000Z', list: 'personal' });
    const inOrder = [...items].sort((x, y) => x.createdAt.localeCompare(y.createdAt)).map((i) => i.title);
    expect(inOrder).toEqual(['melk', 'brood', 'bel de tandarts']);
    expect(items.find((i) => i.title === 'brood')!.grocery).toEqual({ canonicalName: 'bread', displayName: 'brood', quantity: null, section: 'Bread & bakery' });
  });

  it('sends the text without its prefix and forces the list', async () => {
    const { capture } = await captureText('w taart regelen voor Anna');
    answer = () => out({ title: 'taart regelen voor Anna', list: 'personal' });
    await sortCapture(deps(), capture.id, 1000);
    expect(calls[0]).toMatchObject({ text: 'taart regelen voor Anna', fixedList: 'work' });
    expect((await live())[0]).toMatchObject({ list: 'work', title: 'taart regelen voor Anna' });
  });

  it('keeps the reminder the phone computed, and does not re-send it if it already fired', async () => {
    const { capture, item } = await captureText('over 10 minuten oven uit');
    db.raw.prepare('UPDATE items SET notified_at = ? WHERE id = ?').run(at(13).toISOString(), item.id);
    answer = () => out({ title: 'oven uit', remindAt: '2026-11-26T14:14:00+01:00' });
    await sortCapture(deps(20), capture.id, 1000);
    expect(calls[0]!.deviceRemindAt).toBe(item.remindAt);
    expect((await live())[0]).toMatchObject({ title: 'oven uit', remindAt: item.remindAt, notifiedAt: at(13).toISOString() });
  });

  it('puts a guess under Personal, marked unsorted', async () => {
    const { capture } = await captureText('blauw');
    answer = () => out({ title: 'blauw', list: 'work', confidence: 0.2 });
    await sortCapture(deps(), capture.id, 1000);
    expect((await live())[0]).toMatchObject({ list: 'personal', unsorted: true });
  });

  it('wins over the phone copy even when the phone clock runs ahead', async () => {
    const made = createCapture('iets', 'typed', at(3), S, newId);
    const ahead = at(9).toISOString(); // phone is 5 minutes ahead of the server
    await sync(db.d1, { since: 0, captures: [made.capture], items: [{ ...made.item, updatedAt: ahead }], settings: null }, at(4));
    await sortCapture(deps(4), made.capture.id, 1000);
    expect((await live())[0]!.updatedAt > ahead).toBe(true);
  });
});

describe('grocery de-duplication', () => {
  it('merges across languages and bumps the quantity instead of adding a duplicate', async () => {
    const first = await captureText('g melk');
    answer = () => out(groc('milk', 'melk'));
    await sortCapture(deps(), first.capture.id, 1000);

    const second = await captureText('milk', 5);
    answer = () => out(groc('milk', 'milk'));
    await sortCapture(deps(6), second.capture.id, 1000);

    const items = await live();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: first.item.id, title: 'melk', grocery: { canonicalName: 'milk', displayName: 'melk', quantity: 2 } });
    expect((await allItems()).find((i) => i.id === second.item.id)!.deletedAt).not.toBeNull();
    expect(captureRow(second.capture.id)).toMatchObject({ sort_status: 'sorted', text: 'milk' });
  });

  it('adds given quantities', async () => {
    const first = await captureText('2 pakken melk');
    answer = () => out(groc('milk', 'pakken melk', 2));
    await sortCapture(deps(), first.capture.id, 1000);
    const second = await captureText('3 melk', 5);
    answer = () => out(groc('milk', 'melk', 3));
    await sortCapture(deps(6), second.capture.id, 1000);
    expect((await live())[0]!.grocery!.quantity).toBe(5);
  });

  it('merges only the duplicate when a capture mixes new and known groceries', async () => {
    const first = await captureText('melk');
    answer = () => out(groc('milk', 'melk'));
    await sortCapture(deps(), first.capture.id, 1000);
    const second = await captureText('brood en melk', 5);
    answer = () => out(groc('bread', 'brood', null, 'Bread & bakery'), groc('milk', 'melk'));
    await sortCapture(deps(6), second.capture.id, 1000);
    const items = await live();
    expect(items.map((i) => `${i.title}:${i.grocery!.quantity}`).sort()).toEqual(['brood:null', 'melk:2']);
    expect(items.find((i) => i.title === 'brood')!.id).toBe(second.item.id);
  });

  it('merges a product named twice in one capture', async () => {
    const { capture } = await captureText('melk en nog een melk');
    answer = () => out(groc('milk', 'melk'), groc('milk', 'melk'));
    await sortCapture(deps(), capture.id, 1000);
    const items = await live();
    expect(items).toHaveLength(1);
    expect(items[0]!.grocery!.quantity).toBe(2);
  });

  it('does not merge into a ticked-off grocery: it is a new line', async () => {
    const first = await captureText('melk');
    answer = () => out(groc('milk', 'melk'));
    await sortCapture(deps(), first.capture.id, 1000);
    db.raw.prepare("UPDATE items SET status = 'done' WHERE id = ?").run(first.item.id);
    const second = await captureText('melk', 5);
    await sortCapture(deps(6), second.capture.id, 1000);
    expect((await live()).filter((i) => i.status === 'open').map((i) => i.id)).toEqual([second.item.id]);
  });
});

describe('never overwrite the user', () => {
  it('skips a capture whose item was fixed by hand', async () => {
    const { capture, item } = await captureText('iets');
    await sync(db.d1, { since: 0, captures: [], items: [{ ...item, title: 'by hand', provisional: false, updatedAt: at(4).toISOString() }], settings: null }, at(4));
    expect(await sortCapture(deps(5), capture.id, 1000)).toBe('skipped');
    expect(calls).toEqual([]);
    expect((await live())[0]!.title).toBe('by hand');
    expect(captureRow(capture.id).sort_status).toBe('sorted');
  });

  it('leaves an undone capture alone', async () => {
    const { capture, item } = await captureText('vergissing');
    const stamp = at(4).toISOString();
    await sync(db.d1, { since: 0, captures: [{ ...capture, deletedAt: stamp, updatedAt: stamp }], items: [{ ...item, deletedAt: stamp, updatedAt: stamp }], settings: null }, at(4));
    expect(await sortCapture(deps(5), capture.id, 1000)).toBe('busy');
    expect(calls).toEqual([]);
  });

  it('a later hand edit still wins over the sorted item (last write wins)', async () => {
    const { capture, item } = await captureText('iets');
    await sortCapture(deps(4), capture.id, 1000);
    await sync(db.d1, { since: 0, captures: [], items: [{ ...item, title: 'mine', provisional: false, updatedAt: at(10).toISOString() }], settings: null }, at(10));
    expect((await live())[0]!.title).toBe('mine');
  });
});

describe('failures, retries and the daily cap', () => {
  it('keeps the provisional item and retries with growing pauses', async () => {
    const { capture, item } = await captureText('over 10 minuten thee');
    answer = () => {
      throw new Error('Anthropic API 529: overloaded');
    };
    expect(await sortCapture(deps(4), capture.id, 1000)).toBe('failed');
    expect(captureRow(capture.id)).toMatchObject({ sort_status: 'pending', sort_attempts: 1, sort_next_at: at(5).toISOString(), sort_error: 'Anthropic API 529: overloaded' });
    expect((await live())[0]).toMatchObject({ id: item.id, provisional: true, remindAt: item.remindAt });

    expect(await sortCapture(deps(4), capture.id, 1000)).toBe('busy'); // too soon
    expect(await sortCapture(deps(5), capture.id, 1000)).toBe('failed');
    expect(captureRow(capture.id)).toMatchObject({ sort_attempts: 2, sort_next_at: at(7).toISOString() });

    answer = () => out({ title: 'thee' });
    expect(await sortCapture(deps(7), capture.id, 1000)).toBe('sorted');
    expect((await live())[0]).toMatchObject({ title: 'thee', provisional: false });
  });

  it('treats invalid model output as a failure', async () => {
    const { capture } = await captureText('iets');
    answer = () => ({ items: [{ title: 'x', list: 'inbox' }] });
    expect(await sortCapture(deps(), capture.id, 1000)).toBe('failed');
    expect(String(captureRow(capture.id).sort_error)).toContain('list');
    expect((await live())[0]!.provisional).toBe(true);
  });

  it('gives up after the last attempt and leaves the item as it was', async () => {
    const { capture } = await captureText('iets');
    answer = () => {
      throw new Error('down');
    };
    let now = at(4);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(await sortCapture({ ...deps(), now }, capture.id, 1000)).toBe('failed');
      now = new Date(now.getTime() + 7 * 3_600_000);
    }
    expect(captureRow(capture.id)).toMatchObject({ sort_status: 'failed', sort_attempts: MAX_ATTEMPTS });
    expect(await sortCapture({ ...deps(), now }, capture.id, 1000)).toBe('busy');
    expect(calls).toHaveLength(MAX_ATTEMPTS);
  });

  it('retries a capture whose run died half-way, once the lease is over', async () => {
    const { capture } = await captureText('iets');
    db.raw.prepare("UPDATE captures SET sort_status = 'sorting', sort_attempts = 1, sort_next_at = ? WHERE id = ?").run(at(6).toISOString(), capture.id);
    expect(await sortCapture(deps(5), capture.id, 1000)).toBe('busy');
    expect(await sortCapture(deps(6), capture.id, 1000)).toBe('sorted');
  });

  it('two runs at once sort a capture only once', async () => {
    const { capture } = await captureText('g melk');
    answer = () => out(groc('milk', 'melk'));
    const results = await Promise.all([sortCapture(deps(), capture.id, 1000), sortCapture(deps(), capture.id, 1000)]);
    expect(results.sort()).toEqual(['busy', 'sorted']);
    expect(calls).toHaveLength(1);
  });

  it('stops calling the model at the daily cap and picks up again the next day', async () => {
    const capped = { ...S, llm: { enabled: true, dailyCap: 2 } };
    const made = [await captureText('a'), await captureText('b'), await captureText('c')];
    const tally = await sortPending({ ...deps(4, capped) }, 10, 1000);
    expect(tally).toMatchObject({ sorted: 2, capped: 1 });
    expect(calls).toHaveLength(2);
    expect(captureRow(made[2]!.capture.id)).toMatchObject({ sort_status: 'pending', sort_attempts: 0, sort_error: 'daily cap reached' });
    expect(db.raw.prepare('SELECT day, calls FROM llm_usage').all()).toEqual([{ day: '2026-11-26', calls: 2 }]);

    const tomorrow: SortDeps = { ...deps(4, capped), now: new Date('2026-11-27T08:00:00.000Z') };
    expect(await sortPending(tomorrow, 10, 1000)).toMatchObject({ sorted: 1 });
  });

  it('the cron sorts waiting captures oldest first, a few per run', async () => {
    await captureText('eerste', 1);
    await captureText('tweede', 2);
    await captureText('derde', 3);
    answer = (input) => out({ title: input.text });
    expect(await sortPending(deps(), 2, 1000)).toMatchObject({ sorted: 2 });
    expect(calls.map((c) => c.text)).toEqual(['eerste', 'tweede']);
  });
});

describe('sorting inside the sync request', () => {
  const env = (extra: Partial<Env> = {}): Env => ({ DB: db.d1, ALLOWED_ORIGINS: 'https://jessezwienenberg.github.io', APP_TOKEN: 'tok', ANTHROPIC_API_KEY: 'sk-test', ...extra });
  const post = (body: unknown, e = env()) =>
    worker.fetch(new Request('https://w.example/v1/sync', { method: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }), e);
  const anthropic = (input: unknown) => new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 't', name: 'file_items', input }] }), { status: 200 });

  afterEach(() => vi.unstubAllGlobals());

  it('returns the sorted items in the same response', async () => {
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
      return anthropic(out(groc('ketchup', 'ketchup', null, 'Pantry')));
    });
    const made = createCapture('ketchup', 'typed', at(3), S, newId);
    const res = await post({ since: 0, captures: [made.capture], items: [made.item] });
    const body = (await res.json()) as SyncResponse;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: made.item.id, list: 'groceries', provisional: false, grocery: { canonicalName: 'ketchup', section: 'Pantry' } });
    expect(body.captures[0]).toMatchObject({ sortStatus: 'sorted', text: 'ketchup' });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen[0]!.headers['x-api-key']).toBe('sk-test');
    expect(seen[0]!.headers['anthropic-version']).toBe('2023-06-01');
    expect(seen[0]!.body.model).toBe('claude-haiku-5-5');
  });

  it('answers with the provisional item when the model fails, and never loses the capture', async () => {
    vi.stubGlobal('fetch', async () => new Response('overloaded', { status: 529 }));
    const made = createCapture('over 10 minuten oven uit', 'typed', at(3), S, newId);
    const res = await post({ since: 0, captures: [made.capture], items: [made.item] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncResponse;
    expect(body.items[0]).toMatchObject({ id: made.item.id, provisional: true, remindAt: made.item.remindAt });
    expect(captureRow(made.capture.id).sort_status).toBe('pending');
  });

  it('does not call the model when sorting is switched off or no key is set', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const a = createCapture('een', 'typed', at(3), S, newId);
    await post({ since: 0, captures: [a.capture], items: [a.item], settings: { value: { ...S, llm: { enabled: false, dailyCap: 300 } }, updatedAt: at(3).toISOString() } });
    const b = createCapture('twee', 'typed', at(3), S, newId);
    await post({ since: 0, captures: [b.capture], items: [b.item] }, env({ ANTHROPIC_API_KEY: undefined }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('never exposes the API key', async () => {
    vi.stubGlobal('fetch', async () => anthropic(out({ title: 'x' })));
    const made = createCapture('iets', 'typed', at(3), S, newId);
    const text = await (await post({ since: 0, captures: [made.capture], items: [made.item] })).text();
    expect(text).not.toContain('sk-test');
  });
});
