import { describe, expect, it } from 'vitest';
import { createCapture } from '../src/capture';
import { incomingWins, mergeItem } from '../src/merge';
import { DEFAULT_SETTINGS, withDefaults } from '../src/settings';
import type { Item } from '../src/types';
import { parseSyncRequest } from '../src/validate';

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const T1 = '2026-11-26T13:00:00.000Z';
const T2 = '2026-11-26T13:05:00.000Z';

function item(patch: Partial<Item> = {}): Item {
  return { ...createCapture('p test', 'typed', new Date(T1), DEFAULT_SETTINGS, newId).item, ...patch };
}

describe('last write wins', () => {
  it('takes anything when there is no local copy', () => {
    expect(incomingWins(undefined, { updatedAt: T1 }, false)).toBe(true);
  });
  it('takes the newer write', () => {
    expect(incomingWins({ updatedAt: T1 }, { updatedAt: T2 }, true)).toBe(true);
    expect(incomingWins({ updatedAt: T2 }, { updatedAt: T1 }, false)).toBe(false);
  });
  it('on a tie, keeps unsent local changes, otherwise takes the server copy', () => {
    expect(incomingWins({ updatedAt: T1 }, { updatedAt: T1 }, true)).toBe(false);
    expect(incomingWins({ updatedAt: T1 }, { updatedAt: T1 }, false)).toBe(true);
  });
});

describe('mergeItem', () => {
  it('replaces the local item when the server one is newer', () => {
    const local = item({ title: 'old' });
    const incoming = { ...local, title: 'new', updatedAt: T2 };
    expect(mergeItem(local, incoming, false)).toEqual({ item: incoming, dirty: false });
  });

  it('keeps a newer local edit but adopts the server notifiedAt', () => {
    const local = item({ title: 'edited', remindAt: T2, updatedAt: T2 });
    const incoming = { ...local, title: 'stale', updatedAt: T1, notifiedAt: T2 };
    const merged = mergeItem(local, incoming, true);
    expect(merged.item.title).toBe('edited');
    expect(merged.item.notifiedAt).toBe(T2);
    expect(merged.dirty).toBe(true);
  });

  it('re-arms the reminder when the local edit changed the time (snooze)', () => {
    const local = item({ remindAt: '2026-11-26T15:00:00.000Z', updatedAt: T2 });
    const incoming = { ...local, remindAt: T1, updatedAt: T1, notifiedAt: T1 };
    expect(mergeItem(local, incoming, true).item.notifiedAt).toBeNull();
  });
});

describe('createCapture', () => {
  it('keeps the raw text and makes one provisional item', () => {
    const { capture, item: it0 } = createCapture('g  Ketchup ', 'typed', new Date(T1), DEFAULT_SETTINGS, newId);
    expect(capture).toMatchObject({ text: 'g  Ketchup ', capturedAt: T1, source: 'typed', sortStatus: 'pending', deletedAt: null });
    expect(it0).toMatchObject({ captureId: capture.id, list: 'groceries', title: 'Ketchup', provisional: true, status: 'open' });
  });
  it('files unprefixed captures under Personal', () => {
    expect(createCapture('iets', 'share', new Date(T1), DEFAULT_SETTINGS, newId).item.list).toBe('personal');
  });
});

describe('settings', () => {
  it('fills in missing settings with defaults', () => {
    const s = withDefaults({ timeZone: 'UTC', prefixes: { work: 'j' }, fading: { personalDays: 3 } });
    expect(s.timeZone).toBe('UTC');
    expect(s.prefixes).toEqual({ work: 'j', personal: 'p', groceries: 'g' });
    expect(s.fading).toEqual({ personalDays: 3, workDays: 30, overdueDays: 7, groceriesDays: null });
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('parseSyncRequest', () => {
  const now = new Date(T2);
  const good = () => {
    const { capture, item: it0 } = createCapture('in 10 min thee', 'typed', new Date(T1), DEFAULT_SETTINGS, newId);
    return { since: 0, captures: [capture], items: [it0], settings: null };
  };

  it('accepts what the app sends', () => {
    const body = good();
    const parsed = parseSyncRequest(JSON.parse(JSON.stringify(body)), now);
    expect(parsed).toEqual({ ok: true, value: body });
  });

  it('accepts an empty pull', () => {
    expect(parseSyncRequest({}, now)).toEqual({ ok: true, value: { since: 0, captures: [], items: [], settings: null } });
  });

  it('never lets a client set server-owned fields', () => {
    const body = good();
    body.items[0]!.notifiedAt = T1;
    body.captures[0]!.sortStatus = 'sorted';
    const parsed = parseSyncRequest(body, now);
    expect(parsed.ok && parsed.value.items[0]!.notifiedAt).toBeNull();
    expect(parsed.ok && parsed.value.captures[0]!.sortStatus).toBe('pending');
  });

  it('pulls a clock that runs ahead back to now', () => {
    const body = good();
    body.items[0]!.updatedAt = '2030-01-01T00:00:00.000Z';
    const parsed = parseSyncRequest(body, now);
    expect(parsed.ok && parsed.value.items[0]!.updatedAt).toBe(T2);
  });

  it.each([
    ['not an object', () => 'x'],
    ['negative cursor', () => ({ since: -1 })],
    ['bad id', () => ({ items: [{ ...good().items[0], id: 'nope' }] })],
    ['bad list', () => ({ items: [{ ...good().items[0], list: 'inbox' }] })],
    ['bad time', () => ({ items: [{ ...good().items[0], remindAt: 'tomorrow' }] })],
    ['time without milliseconds', () => ({ items: [{ ...good().items[0], updatedAt: '2026-11-26T13:00:00Z' }] })],
    ['missing text', () => ({ captures: [{ ...good().captures[0], text: undefined }] })],
    ['huge text', () => ({ captures: [{ ...good().captures[0], text: 'x'.repeat(10_001) }] })],
    ['too many rows', () => ({ items: Array.from({ length: 201 }, () => good().items[0]) })],
    ['bad quantity', () => ({ items: [{ ...good().items[0], grocery: { canonicalName: 'milk', displayName: 'melk', quantity: 'two', section: 'Dairy & eggs' } }] })],
  ])('rejects %s', (_name, make) => {
    expect(parseSyncRequest(make(), now).ok).toBe(false);
  });
});
