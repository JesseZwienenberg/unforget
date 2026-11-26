// Checks everything a client sends before it gets near the database.
import { withDefaults } from './settings';
import { LISTS, MAX_SYNC_ROWS, MAX_TEXT_LENGTH } from './types';
import type { Capture, Grocery, Item, SettingsDoc, SyncRequest } from './types';

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const ISO_DATE = /^\d{4}-\d\d-\d\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK_SLACK_MS = 5 * 60_000;

class Invalid extends Error {}
const fail = (what: string): never => {
  throw new Invalid(what);
};

type Rec = Record<string, unknown>;
const rec = (v: unknown, what: string): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : fail(what));
const str = (v: unknown, what: string, max = 500): string =>
  typeof v === 'string' && v.length <= max ? v : fail(what);
const id = (v: unknown, what: string): string => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : fail(what));
const iso = (v: unknown, what: string): string =>
  typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : fail(what);
const isoOrNull = (v: unknown, what: string): string | null => (v === null || v === undefined ? null : iso(v, what));
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(what));
function oneOf<T extends string>(v: unknown, options: readonly T[], what: string): T {
  return options.includes(v as T) ? (v as T) : fail(what);
}

/** A device clock far in the future must not win every later conflict. */
function clampFuture(stamp: string, now: Date): string {
  return Date.parse(stamp) > now.getTime() + CLOCK_SLACK_MS ? now.toISOString() : stamp;
}

function capture(v: unknown, now: Date): Capture {
  const r = rec(v, 'capture');
  return {
    id: id(r.id, 'capture.id'),
    text: str(r.text, 'capture.text', MAX_TEXT_LENGTH),
    capturedAt: iso(r.capturedAt, 'capture.capturedAt'),
    source: oneOf(r.source, ['typed', 'share'] as const, 'capture.source'),
    sortStatus: 'pending', // server-owned; whatever the client says is ignored on update
    updatedAt: clampFuture(iso(r.updatedAt, 'capture.updatedAt'), now),
    deletedAt: isoOrNull(r.deletedAt, 'capture.deletedAt'),
  };
}

function grocery(v: unknown): Grocery | null {
  if (v === null || v === undefined) return null;
  const r = rec(v, 'item.grocery');
  const q = r.quantity;
  return {
    canonicalName: str(r.canonicalName, 'grocery.canonicalName'),
    displayName: str(r.displayName, 'grocery.displayName'),
    quantity: q === null || q === undefined ? null : typeof q === 'number' && Number.isFinite(q) ? q : fail('grocery.quantity'),
    section: str(r.section, 'grocery.section'),
  };
}

function dueAt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))) return v;
  return iso(v, 'item.dueAt');
}

function item(v: unknown, now: Date): Item {
  const r = rec(v, 'item');
  return {
    id: id(r.id, 'item.id'),
    captureId: r.captureId === null || r.captureId === undefined ? null : id(r.captureId, 'item.captureId'),
    list: oneOf(r.list, LISTS, 'item.list'),
    title: str(r.title, 'item.title', MAX_TEXT_LENGTH),
    remindAt: isoOrNull(r.remindAt, 'item.remindAt'),
    dueAt: dueAt(r.dueAt),
    notifiedAt: null, // server-owned
    status: oneOf(r.status, ['open', 'done', 'archived'] as const, 'item.status'),
    touchedAt: iso(r.touchedAt, 'item.touchedAt'),
    grocery: grocery(r.grocery),
    unsorted: bool(r.unsorted, 'item.unsorted'),
    provisional: bool(r.provisional, 'item.provisional'),
    createdAt: iso(r.createdAt, 'item.createdAt'),
    updatedAt: clampFuture(iso(r.updatedAt, 'item.updatedAt'), now),
    deletedAt: isoOrNull(r.deletedAt, 'item.deletedAt'),
  };
}

function settings(v: unknown, now: Date): SettingsDoc | null {
  if (v === null || v === undefined) return null;
  const r = rec(v, 'settings');
  const value = withDefaults(rec(r.value, 'settings.value'));
  if (JSON.stringify(value).length > 20_000) fail('settings too large');
  return { value, updatedAt: clampFuture(iso(r.updatedAt, 'settings.updatedAt'), now) };
}

function rows<T>(v: unknown, what: string, each: (x: unknown) => T): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_SYNC_ROWS) return fail(what);
  return v.map(each);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseSyncRequest(body: unknown, now: Date): Parsed<SyncRequest> {
  try {
    const r = rec(body, 'body');
    const since = r.since ?? 0;
    if (typeof since !== 'number' || !Number.isInteger(since) || since < 0) fail('since');
    return {
      ok: true,
      value: {
        since: since as number,
        captures: rows(r.captures, 'captures', (c) => capture(c, now)),
        items: rows(r.items, 'items', (i) => item(i, now)),
        settings: settings(r.settings, now),
      },
    };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: `invalid ${err.message}` };
    throw err;
  }
}
