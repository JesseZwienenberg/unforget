// The morning digest: one notification that says what matters today. Sent only
// when there is something to say.
import { fadingSoon } from './fading';
import type { PushPayload } from './notify';
import type { Settings } from './settings';
import { formatWhen, localDate, toWallTime } from './time';
import { todayView } from './today';
import type { Item } from './types';

const MAX_LINES = 6;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface DigestContent {
  reminders: Item[];
  due: Item[];
  overdue: Item[];
  fading: Item[];
}

export function digestContent(items: Item[], now: Date, settings: Settings): DigestContent {
  const view = todayView(items, now, settings.timeZone);
  const today = localDate(now, settings.timeZone);
  const reminders = view.today.filter((i) => i.remindAt && localDate(new Date(i.remindAt), settings.timeZone) === today);
  const due = view.today.filter((i) => !reminders.includes(i));
  const listed = new Set([...view.today, ...view.overdue].map((i) => i.id));
  return { reminders, due, overdue: view.overdue, fading: fadingSoon(items, now, settings).filter((i) => !listed.has(i.id)) };
}

/** The digest notification, or null when there is nothing to report. */
export function digestPayload(items: Item[], now: Date, settings: Settings): PushPayload | null {
  const c = digestContent(items, now, settings);
  const counts = [
    c.reminders.length && plural(c.reminders.length, 'reminder'),
    c.due.length && `${c.due.length} due`,
    c.overdue.length && `${c.overdue.length} overdue`,
    c.fading.length && `${c.fading.length} fading soon`,
  ].filter(Boolean);
  if (!counts.length) return null;

  const lines = [
    ...c.reminders.map((i) => `⏰ ${formatWhen(i.remindAt!, settings.timeZone, now)} ${i.title}`),
    ...c.due.map((i) => `Due today: ${i.title}`),
    ...c.overdue.map((i) => `Overdue: ${i.title}`),
    ...c.fading.map((i) => `Fading soon: ${i.title}`),
  ];
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES - 1), `+ ${lines.length - (MAX_LINES - 1)} more`] : lines;
  return { kind: 'digest', title: `Today: ${counts.join(' · ')}`, body: shown.join('\n'), tag: 'digest', itemId: null, actions: [] };
}

const minutesOf = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 8 * 60;
};

/** How long after the digest time it may still go out (the cron or the push service may be late). */
const DIGEST_WINDOW_MINUTES = 180;

/** The local date to send a digest for right now, or null when it is not digest time. */
export function digestDue(now: Date, settings: Settings): string | null {
  const tz = settings.timeZone;
  const today = localDate(now, tz);
  const [y = 0, m = 1, d = 1] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (!settings.digest.days.includes(weekday)) return null;
  const wall = toWallTime(now, tz);
  const minutes = wall.hour * 60 + wall.minute;
  const start = minutesOf(settings.digest.time);
  return minutes >= start && minutes < start + DIGEST_WINDOW_MINUTES ? today : null;
}

/** The nightly clean-up runs once, at or after this local time. */
export const NIGHTLY_AT = '03:00';

/** The local date to run the nightly clean-up for right now, or null before 03:00. */
export function nightlyDue(now: Date, settings: Settings): string | null {
  const wall = toWallTime(now, settings.timeZone);
  return wall.hour * 60 + wall.minute >= minutesOf(NIGHTLY_AT) ? localDate(now, settings.timeZone) : null;
}
