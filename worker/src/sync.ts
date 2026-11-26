// The sync endpoint: accept a device's changes (last write wins per row, decided
// in SQL so it is atomic), then return everything changed since its cursor.
import { withDefaults } from '../../shared/src/settings';
import type { Capture, Item, SettingsDoc, SyncRequest, SyncResponse } from '../../shared/src/types';

export const PAGE_SIZE = 500;

// The device's rows arrive as one JSON parameter and are unpacked with json_each:
// one statement per table however many rows, and no bound-parameter limits.
// `rev` = the freshly raised counter minus the row's position, so every row gets
// its own number.
const UPSERT_CAPTURES = `
INSERT INTO captures (id, text, captured_at, source, sort_status, updated_at, deleted_at, rev)
SELECT
  json_extract(j.value, '$.id'),
  json_extract(j.value, '$.text'),
  json_extract(j.value, '$.capturedAt'),
  json_extract(j.value, '$.source'),
  'pending',
  json_extract(j.value, '$.updatedAt'),
  json_extract(j.value, '$.deletedAt'),
  (SELECT seq FROM sync_state WHERE id = 1) - ?2 - j.key
FROM json_each(?1) AS j WHERE true
ON CONFLICT (id) DO UPDATE SET
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at,
  rev = excluded.rev
WHERE excluded.updated_at > captures.updated_at`;
// Not updated on conflict: text, captured_at, source (a capture's content never
// changes) and sort_status (server-owned).

const UPSERT_ITEMS = `
INSERT INTO items (
  id, capture_id, list, title, remind_at, due_at, notified_at, status, touched_at,
  grocery_canonical, grocery_display, grocery_quantity, grocery_section,
  unsorted, provisional, created_at, updated_at, deleted_at, rev)
SELECT
  json_extract(j.value, '$.id'),
  json_extract(j.value, '$.captureId'),
  json_extract(j.value, '$.list'),
  json_extract(j.value, '$.title'),
  json_extract(j.value, '$.remindAt'),
  json_extract(j.value, '$.dueAt'),
  NULL,
  json_extract(j.value, '$.status'),
  json_extract(j.value, '$.touchedAt'),
  json_extract(j.value, '$.grocery.canonicalName'),
  json_extract(j.value, '$.grocery.displayName'),
  json_extract(j.value, '$.grocery.quantity'),
  json_extract(j.value, '$.grocery.section'),
  json_extract(j.value, '$.unsorted'),
  json_extract(j.value, '$.provisional'),
  json_extract(j.value, '$.createdAt'),
  json_extract(j.value, '$.updatedAt'),
  json_extract(j.value, '$.deletedAt'),
  (SELECT seq FROM sync_state WHERE id = 1) - ?2 - j.key
FROM json_each(?1) AS j WHERE true
ON CONFLICT (id) DO UPDATE SET
  capture_id = excluded.capture_id,
  list = excluded.list,
  title = excluded.title,
  -- notified_at is the server's. It survives edits, and is cleared only when the
  -- reminder time itself changes (snooze), which re-arms the reminder.
  notified_at = CASE WHEN excluded.remind_at IS items.remind_at THEN items.notified_at ELSE NULL END,
  remind_at = excluded.remind_at,
  due_at = excluded.due_at,
  status = excluded.status,
  touched_at = excluded.touched_at,
  grocery_canonical = excluded.grocery_canonical,
  grocery_display = excluded.grocery_display,
  grocery_quantity = excluded.grocery_quantity,
  grocery_section = excluded.grocery_section,
  unsorted = excluded.unsorted,
  provisional = excluded.provisional,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at,
  rev = excluded.rev
WHERE excluded.updated_at > items.updated_at`;

const UPSERT_SETTINGS = `
INSERT INTO settings (id, json, updated_at, rev)
VALUES (1, ?1, ?2, (SELECT seq FROM sync_state WHERE id = 1) - ?3)
ON CONFLICT (id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, rev = excluded.rev
WHERE excluded.updated_at > settings.updated_at`;

interface CaptureRow {
  id: string;
  text: string;
  captured_at: string;
  source: Capture['source'];
  sort_status: Capture['sortStatus'];
  updated_at: string;
  deleted_at: string | null;
  rev: number;
}

interface ItemRow {
  id: string;
  capture_id: string | null;
  list: Item['list'];
  title: string;
  remind_at: string | null;
  due_at: string | null;
  notified_at: string | null;
  status: Item['status'];
  touched_at: string;
  grocery_canonical: string | null;
  grocery_display: string | null;
  grocery_quantity: number | null;
  grocery_section: string | null;
  unsorted: number;
  provisional: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  rev: number;
}

interface SettingsRow {
  json: string;
  updated_at: string;
  rev: number;
}

export function captureFromRow(r: CaptureRow): Capture {
  return {
    id: r.id,
    text: r.text,
    capturedAt: r.captured_at,
    source: r.source,
    sortStatus: r.sort_status,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

export function itemFromRow(r: ItemRow): Item {
  return {
    id: r.id,
    captureId: r.capture_id,
    list: r.list,
    title: r.title,
    remindAt: r.remind_at,
    dueAt: r.due_at,
    notifiedAt: r.notified_at,
    status: r.status,
    touchedAt: r.touched_at,
    grocery:
      r.grocery_canonical === null
        ? null
        : {
            canonicalName: r.grocery_canonical,
            displayName: r.grocery_display ?? r.grocery_canonical,
            quantity: r.grocery_quantity,
            section: r.grocery_section ?? 'Other',
          },
    unsorted: r.unsorted === 1,
    provisional: r.provisional === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function settingsFromRow(r: SettingsRow): SettingsDoc {
  return { value: withDefaults(JSON.parse(r.json)), updatedAt: r.updated_at };
}

export async function sync(db: D1Database, req: SyncRequest, now: Date, pageSize = PAGE_SIZE): Promise<SyncResponse> {
  const nCaptures = req.captures.length;
  const nItems = req.items.length;
  const nSettings = req.settings ? 1 : 0;
  const writes = nCaptures + nItems + nSettings;

  // One batch = one transaction: the writes, and the read that follows them, see a
  // consistent counter even if the phone, the laptop and the cron overlap.
  const statements: D1PreparedStatement[] = [];
  if (writes > 0) {
    statements.push(db.prepare('UPDATE sync_state SET seq = seq + ?1 WHERE id = 1').bind(writes));
    if (nCaptures) statements.push(db.prepare(UPSERT_CAPTURES).bind(JSON.stringify(req.captures), 0));
    if (nItems) statements.push(db.prepare(UPSERT_ITEMS).bind(JSON.stringify(req.items), nCaptures));
    if (req.settings) {
      statements.push(
        db.prepare(UPSERT_SETTINGS).bind(JSON.stringify(req.settings.value), req.settings.updatedAt, nCaptures + nItems),
      );
    }
  }
  const firstRead = statements.length;
  statements.push(
    db.prepare('SELECT * FROM captures WHERE rev > ?1 ORDER BY rev LIMIT ?2').bind(req.since, pageSize + 1),
    db.prepare('SELECT * FROM items WHERE rev > ?1 ORDER BY rev LIMIT ?2').bind(req.since, pageSize + 1),
    db.prepare('SELECT json, updated_at, rev FROM settings WHERE id = 1 AND rev > ?1').bind(req.since),
    db.prepare('SELECT seq FROM sync_state WHERE id = 1'),
  );

  const results = await db.batch(statements);
  let captureRows = (results[firstRead]?.results ?? []) as unknown as CaptureRow[];
  let itemRows = (results[firstRead + 1]?.results ?? []) as unknown as ItemRow[];
  let settingsRow = ((results[firstRead + 2]?.results ?? []) as unknown as SettingsRow[])[0] ?? null;
  const seq = ((results[firstRead + 3]?.results ?? []) as unknown as { seq: number }[])[0]?.seq ?? 0;

  // Too much for one response: cut at a rev both lists are complete up to.
  let cursor = seq;
  let more = false;
  const cuts: number[] = [];
  if (captureRows.length > pageSize) cuts.push(captureRows[pageSize - 1]!.rev);
  if (itemRows.length > pageSize) cuts.push(itemRows[pageSize - 1]!.rev);
  if (cuts.length) {
    cursor = Math.min(...cuts);
    more = true;
    captureRows = captureRows.filter((r) => r.rev <= cursor);
    itemRows = itemRows.filter((r) => r.rev <= cursor);
    if (settingsRow && settingsRow.rev > cursor) settingsRow = null;
  }

  return {
    cursor,
    more,
    captures: captureRows.map(captureFromRow),
    items: itemRows.map(itemFromRow),
    settings: settingsRow ? settingsFromRow(settingsRow) : null,
    serverTime: now.toISOString(),
  };
}
