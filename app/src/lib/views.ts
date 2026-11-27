// Pure functions that decide what each screen shows. Tested without a browser.
import type { Settings } from '$shared/settings';
import { dueDate, localDate } from '$shared/time';
import type { Item, ListId } from '$shared/types';

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

export function listItems(items: Item[], list: ListId): Item[] {
  return items.filter((i) => open(i) && i.list === list).sort(byTimeThenNewest);
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

export function isOverdue(item: Item, now: Date, timeZone: string): boolean {
  if (item.status !== 'open') return false;
  if (item.remindAt && item.remindAt < now.toISOString()) return true;
  return Boolean(item.dueAt && dueDate(item.dueAt, timeZone) < localDate(now, timeZone));
}

export interface GrocerySection {
  name: string;
  items: Item[];
}

export const RECENT_GROCERIES = 20;

/** Open groceries grouped by section in the configured order, plus recently ticked ones. */
export function groceryView(items: Item[], settings: Settings): { sections: GrocerySection[]; recent: Item[] } {
  const groceries = items.filter((i) => i.list === 'groceries' && i.deletedAt === null);
  const order = settings.grocerySections;
  const fallback = order.includes('Other') ? 'Other' : (order[order.length - 1] ?? 'Other');
  const bySection = new Map<string, Item[]>();
  for (const item of groceries.filter(open)) {
    const wanted = item.grocery?.section;
    const name = wanted && order.includes(wanted) ? wanted : fallback;
    bySection.set(name, [...(bySection.get(name) ?? []), item]);
  }
  const names = [...order, ...[...bySection.keys()].filter((n) => !order.includes(n))];
  const sections = names
    .filter((name) => bySection.has(name))
    .map((name) => ({ name, items: bySection.get(name)!.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }));

  // Ticked items, most recent first, without ones that are already back on the list.
  const openNames = new Set(groceries.filter(open).map(groceryKey));
  const seen = new Set<string>();
  const recent: Item[] = [];
  for (const item of groceries.filter((i) => i.status === 'done').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const key = groceryKey(item);
    if (openNames.has(key) || seen.has(key)) continue;
    seen.add(key);
    recent.push(item);
    if (recent.length === RECENT_GROCERIES) break;
  }
  return { sections, recent };
}

/**
 * The grocery details that go with an edited item. Renaming a grocery also renames
 * what de-duplication matches on; moving it off the grocery list drops the details.
 */
export function groceryAfterEdit(old: Item, title: string, list: ListId): Item['grocery'] {
  if (list !== 'groceries' || !old.grocery) return null;
  if (title === old.title) return old.grocery;
  return { ...old.grocery, displayName: title, canonicalName: title.trim().toLowerCase() };
}

export function groceryKey(item: Item): string {
  return (item.grocery?.canonicalName ?? item.title).trim().toLowerCase();
}

/** What a grocery line shows. The title is the truth: it is what an edit changes. */
export function groceryLabel(item: Item): string {
  const name = item.title;
  const q = item.grocery?.quantity;
  return q && q !== 1 ? `${name} × ${q}` : name;
}
