// Pure functions that decide what each screen shows. Tested without a browser.
import type { Settings } from '$shared/settings';
import { dueDate, localDate } from '$shared/time';
import { byTimeThenNewest } from '$shared/today';
import type { Item, ListId } from '$shared/types';

export { byTimeThenNewest, todayView, type TodayView } from '$shared/today';

const open = (i: Item): boolean => i.status === 'open' && i.deletedAt === null;

export function listItems(items: Item[], list: ListId): Item[] {
  return items.filter((i) => open(i) && i.list === list).sort(byTimeThenNewest);
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
