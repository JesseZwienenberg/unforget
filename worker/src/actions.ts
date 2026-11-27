// A button pressed on a notification: "Done" or a snooze. Runs without the app open,
// so the server makes the change and devices pick it up on their next sync.
import type { Settings } from '../../shared/src/settings';
import { resolveSnooze, snoozePreset } from '../../shared/src/snooze';
import type { Item } from '../../shared/src/types';
import { itemFromRow } from './sync';

export type ActionResult = { ok: true; item: Item } | { ok: false; status: number; error: string };

const BUMP = 'UPDATE sync_state SET seq = seq + 1 WHERE id = 1';
const SELECT = 'SELECT * FROM items WHERE id = ?1';

export async function applyAction(db: D1Database, id: string, action: string, now: Date, settings: Settings): Promise<ActionResult> {
  const stamp = now.toISOString();
  let update: D1PreparedStatement;
  if (action === 'done') {
    update = db
      .prepare(
        `UPDATE items SET status = 'done', touched_at = ?2, updated_at = max(?2, updated_at), rev = (SELECT seq FROM sync_state WHERE id = 1)
         WHERE id = ?1 AND deleted_at IS NULL`,
      )
      .bind(id, stamp);
  } else {
    const preset = snoozePreset(action);
    const until = preset ? resolveSnooze(preset, now, settings) : null;
    if (!until) return { ok: false, status: 400, error: 'unknown action' };
    // A new time re-arms the reminder: notified_at is cleared.
    update = db
      .prepare(
        `UPDATE items SET remind_at = ?3, notified_at = NULL, status = 'open', touched_at = ?2, updated_at = max(?2, updated_at),
           rev = (SELECT seq FROM sync_state WHERE id = 1)
         WHERE id = ?1 AND deleted_at IS NULL`,
      )
      .bind(id, stamp, until.toISOString());
  }
  const results = await db.batch([db.prepare(BUMP), update, db.prepare(SELECT).bind(id)]);
  const row = (results[2]?.results ?? [])[0] as Parameters<typeof itemFromRow>[0] | undefined;
  if (!row || row.deleted_at) return { ok: false, status: 404, error: 'not_found' };
  return { ok: true, item: itemFromRow(row) };
}
