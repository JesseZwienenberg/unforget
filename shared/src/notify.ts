// What the Worker pushes and the service worker shows.
import type { Settings } from './settings';
import { actionLabel } from './snooze';
import { formatWhen } from './time';
import { LIST_NAMES, type Item } from './types';

export interface PushPayload {
  kind: 'reminder' | 'test';
  title: string;
  body: string;
  /** Same tag = the newer notification replaces the older one. */
  tag: string;
  itemId: string | null;
  actions: { action: string; title: string }[];
}

/** A reminder counts as late when it goes out more than this long after its time. */
export const LATE_AFTER_MS = 90_000;
/** Older than this and it is not sent at all; it shows as overdue in the app instead. */
export const STALE_AFTER_MS = 24 * 3_600_000;

export function isLate(remindAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(remindAt) > LATE_AFTER_MS;
}

export function reminderPayload(item: Pick<Item, 'id' | 'title' | 'list' | 'remindAt'>, now: Date, settings: Settings): PushPayload {
  const when = item.remindAt ? formatWhen(item.remindAt, settings.timeZone, now) : '';
  const late = item.remindAt ? isLate(item.remindAt, now) : false;
  return {
    kind: 'reminder',
    title: item.title,
    body: late ? `Late · was due ${when} · ${LIST_NAMES[item.list]}` : `⏰ ${when} · ${LIST_NAMES[item.list]}`,
    tag: `item-${item.id}`,
    itemId: item.id,
    actions: settings.notificationButtons.map((action) => ({ action, title: actionLabel(action) })),
  };
}

export function testPayload(now: Date, settings: Settings): PushPayload {
  return {
    kind: 'test',
    title: 'Unforget test',
    body: `Notifications work. Sent ${formatWhen(now.toISOString(), settings.timeZone, now)}.`,
    tag: 'test',
    itemId: null,
    actions: [],
  };
}
