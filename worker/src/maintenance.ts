// The once-a-day jobs inside the per-minute cron: the nightly clean-up (fading)
// and the morning digest. Each claims its day in the `meta` table first, so it
// runs once even if cron minutes overlap or are skipped.
import { digestDue, digestPayload, nightlyDue } from '../../shared/src/digest';
import { shouldFade } from '../../shared/src/fading';
import type { Settings } from '../../shared/src/settings';
import type { Item } from '../../shared/src/types';
import { listSubscriptions, sendToAll, type Sender } from './push';
import { itemFromRow } from './sync';

type Row = Parameters<typeof itemFromRow>[0];

async function openItems(db: D1Database): Promise<Item[]> {
  const { results } = await db.prepare("SELECT * FROM items WHERE status = 'open' AND deleted_at IS NULL").all();
  return (results as unknown as Row[]).map(itemFromRow);
}

/** True when this run gets to do the job for that day. */
async function claimDay(db: D1Database, key: string, day: string): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?1, ?2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE meta.value != excluded.value
       RETURNING value`,
    )
    .bind(key, day)
    .first();
  return row !== null;
}

const releaseDay = (db: D1Database, key: string, day: string) =>
  db.prepare("UPDATE meta SET value = '' WHERE key = ?1 AND value = ?2").bind(key, day).run();

const after = (previous: string, now: Date) => {
  const stamp = now.toISOString();
  return stamp > previous ? stamp : new Date(Date.parse(previous) + 1).toISOString();
};

/** Archives every item whose time is up. Archived, never deleted. Returns how many. */
export async function runFading(db: D1Database, settings: Settings, now: Date): Promise<number> {
  const fading = (await openItems(db)).filter((item) => shouldFade(item, now, settings));
  // In chunks, to stay well inside the per-request statement limits.
  for (let start = 0; start < fading.length; start += 40) {
    const chunk = fading.slice(start, start + 40);
    await db.batch([
      db.prepare('UPDATE sync_state SET seq = seq + ?1 WHERE id = 1').bind(chunk.length),
      ...chunk.map((item, k) =>
        db
          .prepare(
            `UPDATE items SET status = 'archived', updated_at = ?2, rev = (SELECT seq FROM sync_state WHERE id = 1) - ?3
             WHERE id = ?1 AND status = 'open'`,
          )
          .bind(item.id, after(item.updatedAt, now), k),
      ),
    ]);
  }
  return fading.length;
}

export async function nightlyIfDue(db: D1Database, settings: Settings, now: Date): Promise<number | null> {
  const day = nightlyDue(now, settings);
  if (!day || !(await claimDay(db, 'fade_day', day))) return null;
  return runFading(db, settings, now);
}

export type DigestOutcome = 'not-due' | 'already-sent' | 'nothing-to-say' | 'no-devices' | 'sent' | 'failed';

export async function digestIfDue(db: D1Database, send: Sender, settings: Settings, now: Date): Promise<DigestOutcome> {
  const day = digestDue(now, settings);
  if (!day) return 'not-due';
  if (!(await claimDay(db, 'digest_day', day))) return 'already-sent';
  const payload = digestPayload(await openItems(db), now, settings);
  if (!payload) return 'nothing-to-say';
  const subs = await listSubscriptions(db);
  if (!subs.length) return 'no-devices';
  const outcomes = await sendToAll(db, send, subs, payload, now);
  if (outcomes.some((o) => o.ok)) return 'sent';
  // Nobody got it: give the day back so the next minute tries again.
  await releaseDay(db, 'digest_day', day);
  return 'failed';
}
