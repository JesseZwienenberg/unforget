// Sorting one capture end to end: claim it, ask the model, validate, and replace
// the phone's provisional item with the result in one transaction.
import { parseCapture, splitPrefix } from '../../../shared/src/parse';
import type { Settings } from '../../../shared/src/settings';
import { localDate } from '../../../shared/src/time';
import type { ListId } from '../../../shared/src/types';
import { capitalizeFirst } from '../../../shared/src/text';
import { recordTokens } from '../usage';
import type { Sorter } from './llm';
import { parseSortOutput, type SortedItem } from './output';

export type SortOutcome =
  | 'sorted'
  /** Nothing to do: the capture was undone, or its item was already fixed by hand. */
  | 'skipped'
  /** The model call or its output failed; the cron retries with backoff. */
  | 'failed'
  /** The daily call cap is reached. */
  | 'capped'
  /** Not ours to sort right now: another run has it, or it is waiting out a backoff. */
  | 'busy';

/** Below this the sorter is guessing: the item goes to Personal, marked unsorted. */
export const MIN_CONFIDENCE = 0.6;
export const MAX_ATTEMPTS = 6;
/** Minutes to wait after the 1st, 2nd, … failed attempt. */
const BACKOFF_MINUTES = [1, 2, 5, 15, 60, 360];
/** While a run holds a capture, nobody else touches it for this long. */
const LEASE_MS = 2 * 60_000;
const SNAP_MS = 2 * 60_000;

export interface SortDeps {
  db: D1Database;
  sorter: Sorter;
  settings: Settings;
  now: Date;
}

interface CaptureRow {
  id: string;
  text: string;
  captured_at: string;
  sort_attempts: number;
}

interface ItemRow {
  id: string;
  status: string;
  provisional: number;
  remind_at: string | null;
  touched_at: string;
  created_at: string;
  updated_at: string;
}

interface OpenGrocery {
  id: string;
  grocery_canonical: string;
  grocery_quantity: number | null;
  updated_at: string;
}

const plusMs = (date: Date, ms: number) => new Date(date.getTime() + ms).toISOString();
/** A stamp later than both the clock and the row's previous one, so every device accepts the change. */
const after = (previous: string, now: Date) => {
  const stamp = now.toISOString();
  return stamp > previous ? stamp : new Date(Date.parse(previous) + 1).toISOString();
};

/** A stable id for the n-th extra item of a capture, so a retry writes the same rows. */
export async function derivedId(captureId: string, index: number): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${captureId}:${index}`)));
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function claim(db: D1Database, id: string, now: Date): Promise<CaptureRow | null> {
  const stamp = now.toISOString();
  return db
    .prepare(
      `UPDATE captures SET sort_status = 'sorting', sort_attempts = sort_attempts + 1, sort_next_at = ?2
       WHERE id = ?1 AND sort_status IN ('pending', 'sorting') AND deleted_at IS NULL
         AND (sort_next_at IS NULL OR sort_next_at <= ?3)
       RETURNING id, text, captured_at, sort_attempts`,
    )
    .bind(id, plusMs(now, LEASE_MS), stamp)
    .first<CaptureRow>();
}

/** Counts one model call against today's cap. False when the cap is reached. */
export async function reserveCall(db: D1Database, settings: Settings, now: Date): Promise<boolean> {
  const cap = settings.llm.dailyCap;
  if (cap <= 0) return false;
  const row = await db
    .prepare(
      `INSERT INTO llm_usage (day, calls) VALUES (?1, 1)
       ON CONFLICT (day) DO UPDATE SET calls = calls + 1 WHERE calls < ?2
       RETURNING calls`,
    )
    .bind(localDate(now, settings.timeZone), cap)
    .first<{ calls: number }>();
  return row !== null;
}

const bumpSeq = (db: D1Database, by: number) => db.prepare('UPDATE sync_state SET seq = seq + ?1 WHERE id = 1').bind(by);
const REV = '(SELECT seq FROM sync_state WHERE id = 1)';

async function finish(db: D1Database, id: string, status: 'sorted' | 'failed' | 'pending', nextAt: string | null, error: string | null, undoAttempt = false) {
  await db.batch([
    bumpSeq(db, 1),
    db
      .prepare(
        `UPDATE captures SET sort_status = ?2, sort_next_at = ?3, sort_error = ?4, sort_attempts = sort_attempts - ?5, rev = ${REV} WHERE id = ?1`,
      )
      .bind(id, status, nextAt, error, undoAttempt ? 1 : 0),
  ]);
}

/** Applies the user's intent on top of the model's answer. */
export function settle(items: SortedItem[], fixedList: ListId | null, deviceRemindAt: string | null, settings: Settings): (SortedItem & { unsorted: boolean })[] {
  const sections = settings.grocerySections;
  const fallbackSection = sections.includes('Other') ? 'Other' : (sections[sections.length - 1] ?? 'Other');
  const settled = items.map((raw) => {
    // Every item starts with a capital, whatever the model wrote.
    const item = {
      ...raw,
      title: capitalizeFirst(raw.title),
      grocery: raw.grocery ? { ...raw.grocery, displayName: capitalizeFirst(raw.grocery.displayName) } : null,
    };
    // A prefix always wins over the model.
    if (fixedList) {
      const grocery =
        fixedList === 'groceries'
          ? (item.grocery ?? { canonicalName: item.title.toLowerCase(), displayName: item.title, quantity: null, section: fallbackSection })
          : null;
      return { ...item, list: fixedList, grocery, unsorted: false };
    }
    if (item.confidence < MIN_CONFIDENCE) return { ...item, list: 'personal' as const, grocery: null, unsorted: true };
    return { ...item, unsorted: false };
  });
  // The phone computed relative times exactly, from the moment of typing. Keep its value.
  if (deviceRemindAt) {
    const device = Date.parse(deviceRemindAt);
    if (settled.length === 1) settled[0]!.remindAt = deviceRemindAt;
    else for (const item of settled) if (item.remindAt && Math.abs(Date.parse(item.remindAt) - device) <= SNAP_MS) item.remindAt = deviceRemindAt;
  }
  return settled;
}

const UPSERT_ITEM = `
INSERT INTO items (
  id, capture_id, list, title, remind_at, due_at, notified_at, status, touched_at,
  grocery_canonical, grocery_display, grocery_quantity, grocery_section,
  unsorted, provisional, created_at, updated_at, deleted_at, rev)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 'open', ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?14, NULL, ${REV} - ?15)
ON CONFLICT (id) DO UPDATE SET
  list = excluded.list, title = excluded.title,
  notified_at = CASE WHEN excluded.remind_at IS items.remind_at THEN items.notified_at ELSE NULL END,
  remind_at = excluded.remind_at, due_at = excluded.due_at,
  grocery_canonical = excluded.grocery_canonical, grocery_display = excluded.grocery_display,
  grocery_quantity = excluded.grocery_quantity, grocery_section = excluded.grocery_section,
  unsorted = excluded.unsorted, provisional = 0, updated_at = excluded.updated_at, rev = excluded.rev`;

async function apply(deps: SortDeps, capture: CaptureRow, provisional: ItemRow, items: (SortedItem & { unsorted: boolean })[]): Promise<void> {
  const { db, now } = deps;
  const { results: open } = await db
    .prepare(
      `SELECT id, grocery_canonical, grocery_quantity, updated_at FROM items
       WHERE list = 'groceries' AND status = 'open' AND deleted_at IS NULL AND grocery_canonical IS NOT NULL
         AND (capture_id IS NULL OR capture_id != ?1)`,
    )
    .bind(capture.id)
    .all<OpenGrocery>();
  const onList = new Map(open.map((g) => [g.grocery_canonical, g]));

  interface NewRow {
    id: string;
    item: SortedItem & { unsorted: boolean };
  }
  const rows: NewRow[] = [];
  const bumps = new Map<string, { quantity: number; updatedAt: string }>();
  const created = new Map<string, NewRow>(); // groceries made in this same capture
  let usedProvisional = false;
  let extra = 0;

  for (const item of items) {
    const key = item.grocery?.canonicalName;
    const add = item.grocery?.quantity ?? 1;
    // Already on the list: bump its quantity instead of adding a duplicate.
    const existing = key ? onList.get(key) : undefined;
    if (existing) {
      const current = bumps.get(existing.id)?.quantity ?? existing.grocery_quantity ?? 1;
      bumps.set(existing.id, { quantity: current + add, updatedAt: after(existing.updated_at, now) });
      continue;
    }
    const twin = key ? created.get(key) : undefined;
    if (twin?.item.grocery) {
      twin.item = { ...twin.item, grocery: { ...twin.item.grocery, quantity: (twin.item.grocery.quantity ?? 1) + add } };
      continue;
    }
    // The first new item takes over the provisional item's id; the rest get stable derived ids.
    const row: NewRow = { id: usedProvisional ? await derivedId(capture.id, ++extra) : provisional.id, item };
    usedProvisional = true;
    rows.push(row);
    if (key) created.set(key, row);
  }

  const statements: D1PreparedStatement[] = [];
  let k = 0;
  for (const row of rows) {
    const { item } = row;
    const g = item.grocery;
    const isProvisional = row.id === provisional.id;
    statements.push(
      db
        .prepare(UPSERT_ITEM)
        .bind(
          row.id,
          capture.id,
          item.list,
          item.title,
          item.remindAt,
          item.dueAt,
          provisional.touched_at,
          g?.canonicalName ?? null,
          g?.displayName ?? null,
          g?.quantity ?? null,
          g?.section ?? null,
          item.unsorted ? 1 : 0,
          // One millisecond apart, so the items keep the order they were written in.
          new Date(Date.parse(provisional.created_at) + k).toISOString(),
          isProvisional ? after(provisional.updated_at, now) : now.toISOString(),
          k++,
        ),
    );
  }
  for (const [id, bump] of bumps) {
    statements.push(
      db
        .prepare(`UPDATE items SET grocery_quantity = ?2, touched_at = ?3, updated_at = ?4, rev = ${REV} - ?5 WHERE id = ?1`)
        .bind(id, bump.quantity, now.toISOString(), bump.updatedAt, k++),
    );
  }
  if (!usedProvisional) {
    // Everything merged into existing groceries: the provisional item has no reason to exist.
    const stamp = after(provisional.updated_at, now);
    statements.push(
      db.prepare(`UPDATE items SET deleted_at = ?2, updated_at = ?2, provisional = 0, rev = ${REV} - ?3 WHERE id = ?1`).bind(provisional.id, stamp, k++),
    );
  }
  statements.push(
    db
      .prepare(`UPDATE captures SET sort_status = 'sorted', sort_next_at = NULL, sort_error = NULL, rev = ${REV} - ?2 WHERE id = ?1`)
      .bind(capture.id, k++),
  );
  await db.batch([bumpSeq(db, k), ...statements]);
}

export async function sortCapture(deps: SortDeps, captureId: string, timeoutMs: number): Promise<SortOutcome> {
  const { db, settings, now } = deps;
  const capture = await claim(db, captureId, now);
  if (!capture) return 'busy';

  const { results: items } = await db
    .prepare('SELECT id, status, provisional, remind_at, touched_at, created_at, updated_at FROM items WHERE capture_id = ?1 AND deleted_at IS NULL')
    .bind(captureId)
    .all<ItemRow>();
  const provisional = items.find((i) => i.provisional === 1 && i.status === 'open');
  if (!provisional) {
    // Already fixed by hand, ticked off or removed: the sorter must not overwrite that.
    await finish(db, captureId, 'sorted', null, null);
    return 'skipped';
  }

  if (!(await reserveCall(db, settings, now))) {
    await finish(db, captureId, 'pending', plusMs(now, 3_600_000), 'daily cap reached', true);
    return 'capped';
  }

  const capturedAt = new Date(capture.captured_at);
  const { list: fixedList, rest } = splitPrefix(capture.text, settings.prefixes);
  const deviceRemindAt = parseCapture(capture.text, capturedAt, settings.prefixes).remindAt;

  let sorted: SortedItem[];
  try {
    const answer = await deps.sorter({ text: rest, capturedAt, settings, fixedList, deviceRemindAt }, timeoutMs);
    // Count the tokens before validating: a useless answer still cost money.
    await recordTokens(db, settings, now, answer.tokens);
    sorted = parseSortOutput(answer.output, settings);
    if (!sorted.length) throw new Error('model returned no items');
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    const exhausted = capture.sort_attempts >= MAX_ATTEMPTS;
    const wait = BACKOFF_MINUTES[Math.min(capture.sort_attempts, BACKOFF_MINUTES.length) - 1] ?? 360;
    await finish(db, captureId, exhausted ? 'failed' : 'pending', exhausted ? null : plusMs(now, wait * 60_000), message);
    return 'failed';
  }

  await apply(deps, capture, provisional, settle(sorted, fixedList, deviceRemindAt, settings));
  return 'sorted';
}

/** The cron's share: captures the sync request could not sort in time, oldest first. */
export async function sortPending(deps: SortDeps, limit: number, timeoutMs: number): Promise<Record<SortOutcome, number>> {
  const tally: Record<SortOutcome, number> = { sorted: 0, skipped: 0, failed: 0, capped: 0, busy: 0 };
  const { results } = await deps.db
    .prepare(
      `SELECT id FROM captures
       WHERE sort_status IN ('pending', 'sorting') AND deleted_at IS NULL AND (sort_next_at IS NULL OR sort_next_at <= ?1)
       ORDER BY captured_at LIMIT ?2`,
    )
    .bind(deps.now.toISOString(), limit)
    .all<{ id: string }>();
  for (const { id } of results) {
    const outcome = await sortCapture(deps, id, timeoutMs);
    tally[outcome]++;
    if (outcome === 'capped') break;
  }
  return tally;
}
