// What counts as "today" and "overdue". Shared: the app's Today tab and the
// server's morning digest must agree.
import { dueDate, localDate } from './time';
import type { Item } from './types';

const open = (i: Item): boolean => i.status === 'open' && i.deletedAt === null;

/** The moment an item is "for": its reminder, else its deadline (end of that day sorts last). */
function sortKey(i: Item): string {
  return i.remindAt ?? (i.dueAt ? (i.dueAt.length === 10 ? `${i.dueAt}T23:59:59.999Z` : i.dueAt) : '');
}

/** Timed items first (soonest first), then the rest, newest first. */
export function byTimeThenNewest(a: Item, b: Item): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka && kb) return ka.localeCompare(kb);
  if (ka) return -1;
  if (kb) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

export interface TodayView {
  overdue: Item[];
  today: Item[];
}

/** Today = reminders today and deadlines today. Overdue = anything dated before today and still open. */
export function todayView(items: Item[], now: Date, timeZone: string): TodayView {
  const today = localDate(now, timeZone);
  const view: TodayView = { overdue: [], today: [] };
  for (const item of items) {
    if (!open(item)) continue;
    const days: string[] = [];
    if (item.remindAt) days.push(localDate(new Date(item.remindAt), timeZone));
    if (item.dueAt) days.push(dueDate(item.dueAt, timeZone));
    if (!days.length) continue;
    if (days.includes(today)) view.today.push(item);
    else if (days.some((d) => d < today)) view.overdue.push(item);
  }
  view.overdue.sort(byTimeThenNewest);
  view.today.sort(byTimeThenNewest);
  return view;
}
