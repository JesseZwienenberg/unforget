// The reminder half of the per-minute cron: find due reminders, claim them, push them.
import { isLate, reminderPayload, STALE_AFTER_MS } from '../../shared/src/notify';
import type { Settings } from '../../shared/src/settings';
import type { Item } from '../../shared/src/types';
import { listSubscriptions, sendToAll, type Sender } from './push';
import { loadSettings } from './settings';
import { itemFromRow } from './sync';

/** Stay inside the free plan's limit on outgoing requests per run. */
const MAX_PUSHES_PER_RUN = 40;

export interface DeliveryReport {
  due: number;
  sent: number;
  late: number;
  /** Too old to send (over 24 hours): marked handled; they show as overdue in the app. */
  skippedStale: number;
  /** Claimed, but no device accepted the push: released, tried again next minute. */
  released: number;
  /** Nothing can be sent because no device has notifications turned on. */
  noDevices: boolean;
}

const DUE = `
SELECT * FROM items
WHERE remind_at IS NOT NULL AND notified_at IS NULL AND status = 'open' AND deleted_at IS NULL
  AND remind_at <= ?1
ORDER BY remind_at
LIMIT ?2`;

// Claiming = setting notified_at, guarded by "still not notified, same time, still open".
// Two overlapping runs (cron + a sync that triggers delivery) can't both win the row,
// so a reminder is never sent twice. `rev` is raised so devices pick up the change.
const CLAIM = `
UPDATE items SET notified_at = ?1, rev = (SELECT seq FROM sync_state WHERE id = 1) - ?2
WHERE id = ?3 AND remind_at = ?4 AND notified_at IS NULL AND status = 'open' AND deleted_at IS NULL
RETURNING id`;

const RELEASE = `
UPDATE items SET notified_at = NULL, rev = (SELECT seq FROM sync_state WHERE id = 1) - ?1
WHERE id = ?2 AND notified_at = ?3`;

const raiseSeq = (db: D1Database, by: number) => db.prepare('UPDATE sync_state SET seq = seq + ?1 WHERE id = 1').bind(by);

async function claim(db: D1Database, items: Item[], stamp: string): Promise<Set<string>> {
  if (!items.length) return new Set();
  const results = await db.batch([
    raiseSeq(db, items.length),
    ...items.map((item, k) => db.prepare(CLAIM).bind(stamp, k, item.id, item.remindAt)),
  ]);
  const won = new Set<string>();
  results.slice(1).forEach((r, k) => {
    if ((r.results ?? []).length) won.add(items[k]!.id);
  });
  return won;
}

async function release(db: D1Database, ids: string[], stamp: string): Promise<void> {
  if (!ids.length) return;
  await db.batch([raiseSeq(db, ids.length), ...ids.map((id, k) => db.prepare(RELEASE).bind(k, id, stamp))]);
}

export async function deliverDueReminders(db: D1Database, send: Sender, now: Date, settings?: Settings): Promise<DeliveryReport> {
  const report: DeliveryReport = { due: 0, sent: 0, late: 0, skippedStale: 0, released: 0, noDevices: false };
  const subs = await listSubscriptions(db);
  const limit = Math.max(1, Math.floor(MAX_PUSHES_PER_RUN / Math.max(1, subs.length)));
  const { results } = await db.prepare(DUE).bind(now.toISOString(), limit).all();
  const due = (results as unknown as Parameters<typeof itemFromRow>[0][]).map(itemFromRow);
  report.due = due.length;
  if (!due.length) return report;

  const stale = due.filter((i) => now.getTime() - Date.parse(i.remindAt!) > STALE_AFTER_MS);
  const fresh = due.filter((i) => !stale.includes(i));
  // The claim stamp doubles as a token for releasing exactly our own claims.
  const stamp = now.toISOString();

  report.skippedStale = (await claim(db, stale, stamp)).size;

  if (!subs.length) {
    // Leave fresh reminders unclaimed: they go out (marked late) once a device subscribes.
    report.noDevices = fresh.length > 0;
    return report;
  }

  const won = await claim(db, fresh, stamp);
  const config = settings ?? (await loadSettings(db));
  const failed: string[] = [];
  for (const item of fresh) {
    if (!won.has(item.id)) continue;
    const outcomes = await sendToAll(db, send, subs, reminderPayload(item, now, config), now);
    if (outcomes.some((o) => o.ok)) {
      report.sent++;
      if (isLate(item.remindAt!, now)) report.late++;
    } else {
      failed.push(item.id);
    }
  }
  await release(db, failed, stamp);
  report.released = failed.length;
  return report;
}
