// Self-cleaning: nothing lives forever untouched. Fading means archived, never deleted.
//
//  - An item with a time (reminder or deadline) that has passed fades `overdueDays`
//    after that time.
//  - An item with a time still ahead does not fade: it is waiting for its moment.
//  - An undated Personal or Work item fades `personalDays` / `workDays` after it
//    was last touched.
//  - Groceries fade only if `groceriesDays` is set (off by default).
//  - Touching an item (snooze, edit, re-add) restarts its clock.
import type { Settings } from './settings';
import { addDays, dueDate } from './time';
import { atLocalTime } from './snooze';
import type { Item } from './types';

const DAY_MS = 24 * 3_600_000;

/** The moment an item's own time is over: its reminder, or the end of its deadline day; the later of the two. */
export function itemTime(item: Item, timeZone: string): Date | null {
  const times: number[] = [];
  if (item.remindAt) times.push(Date.parse(item.remindAt));
  if (item.dueAt) {
    // A date-only deadline lasts until midnight at the end of that local day.
    times.push(item.dueAt.length === 10 ? atLocalTime(addDays(dueDate(item.dueAt, timeZone), 1), '00:00', timeZone).getTime() : Date.parse(item.dueAt));
  }
  return times.length ? new Date(Math.max(...times)) : null;
}

/** When this item will be archived if nobody touches it; null = never (as things stand). */
export function fadesAt(item: Item, settings: Settings): Date | null {
  if (item.status !== 'open' || item.deletedAt) return null;
  const { fading, timeZone } = settings;
  const touched = Date.parse(item.touchedAt);

  if (item.list === 'groceries') {
    return fading.groceriesDays === null ? null : new Date(touched + fading.groceriesDays * DAY_MS);
  }
  const time = itemTime(item, timeZone);
  if (time) {
    if (fading.overdueDays === null) return null;
    // Counts from its time, or from the last touch if that was later.
    return new Date(Math.max(time.getTime(), touched) + fading.overdueDays * DAY_MS);
  }
  const days = item.list === 'work' ? fading.workDays : fading.personalDays;
  return days === null ? null : new Date(touched + days * DAY_MS);
}

export function shouldFade(item: Item, now: Date, settings: Settings): boolean {
  const at = fadesAt(item, settings);
  if (!at || at.getTime() > now.getTime()) return false;
  // A dated item never fades before its own time has come, however old it is.
  const time = item.list === 'groceries' ? null : itemTime(item, settings.timeZone);
  return !time || time.getTime() <= now.getTime();
}

/** Items that will fade within the next `days` days (but have not yet). */
export function fadingSoon(items: Item[], now: Date, settings: Settings, days = 2): Item[] {
  const until = now.getTime() + days * DAY_MS;
  return items
    .filter((item) => {
      const at = fadesAt(item, settings);
      return at !== null && at.getTime() > now.getTime() && at.getTime() <= until;
    })
    .sort((a, b) => fadesAt(a, settings)!.getTime() - fadesAt(b, settings)!.getTime());
}
