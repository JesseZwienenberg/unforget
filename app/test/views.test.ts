import { describe, expect, it } from 'vitest';
import { createCapture } from '$shared/capture';
import { DEFAULT_SETTINGS } from '$shared/settings';
import type { Item } from '$shared/types';
import { groceryLabel, groceryView, isOverdue, listItems, todayView } from '../src/lib/views';

const TZ = 'Europe/Amsterdam';
const NOW = new Date('2026-11-26T13:00:00.000Z'); // Thu 26 Nov 14:00 local
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function item(text: string, patch: Partial<Item> = {}, minute = 0): Item {
  const at = new Date(Date.UTC(2026, 10, 26, 12, minute));
  return { ...createCapture(text, 'typed', at, DEFAULT_SETTINGS, newId).item, ...patch };
}
const titles = (items: Item[]) => items.map((i) => i.title);

describe('todayView', () => {
  const items = [
    item('p later today', { remindAt: '2026-11-26T19:00:00.000Z' }),
    item('p earlier today', { remindAt: '2026-11-26T08:00:00.000Z' }),
    item('w due today', { dueAt: '2026-11-26' }),
    item('p tomorrow', { remindAt: '2026-11-27T08:00:00.000Z' }),
    item('p yesterday', { remindAt: '2026-11-25T08:00:00.000Z' }),
    item('w was due', { dueAt: '2026-11-20' }),
    item('p undated'),
    item('p done today', { remindAt: '2026-11-26T09:00:00.000Z', status: 'done' }),
    item('p just after midnight', { remindAt: '2026-11-26T23:30:00.000Z' }), // 00:30 on the 27th locally
  ];
  const view = todayView(items, NOW, TZ);

  it('shows reminders and deadlines for today, soonest first', () => {
    expect(titles(view.today)).toEqual(['Earlier today', 'Later today', 'Due today']);
  });
  it('shows open items from earlier days as overdue, oldest first', () => {
    expect(titles(view.overdue)).toEqual(['Was due', 'Yesterday']);
  });
  it('uses the local date, not the UTC date', () => {
    expect(titles(view.today)).not.toContain('Just after midnight');
  });
});

describe('isOverdue', () => {
  it('is true for a passed reminder or a deadline before today', () => {
    expect(isOverdue(item('p a', { remindAt: '2026-11-26T12:00:00.000Z' }), NOW, TZ)).toBe(true);
    expect(isOverdue(item('p b', { remindAt: '2026-11-26T14:00:00.000Z' }), NOW, TZ)).toBe(false);
    expect(isOverdue(item('p c', { dueAt: '2026-11-25' }), NOW, TZ)).toBe(true);
    expect(isOverdue(item('p d', { dueAt: '2026-11-26' }), NOW, TZ)).toBe(false);
    expect(isOverdue(item('p e', { dueAt: '2026-11-25', status: 'done' }), NOW, TZ)).toBe(false);
  });
});

describe('listItems', () => {
  it('shows only open items of the list: timed first, then newest first', () => {
    const items = [
      item('w old', {}, 1),
      item('w new', {}, 5),
      item('w deadline', { dueAt: '2026-12-01' }, 2),
      item('w reminder', { remindAt: '2026-11-27T08:00:00.000Z' }, 3),
      item('w finished', { status: 'done' }),
      item('p elsewhere'),
      item('w deleted', { deletedAt: NOW.toISOString() }),
    ];
    expect(titles(listItems(items, 'work'))).toEqual(['Reminder', 'Deadline', 'New', 'Old']);
  });
});

describe('groceryView', () => {
  const g = (name: string, section: string | null, patch: Partial<Item> = {}, minute = 0) =>
    item(`g ${name}`, { grocery: section ? { canonicalName: name, displayName: name, quantity: null, section } : null, ...patch }, minute);

  it('groups by section in the configured order, unknown sections under Other', () => {
    const view = groceryView([g('soap', 'Household'), g('milk', 'Dairy & eggs'), g('apples', 'Fruit & vegetables'), g('thing', null), g('odd', 'Nonexistent')], DEFAULT_SETTINGS);
    expect(view.sections.map((s) => s.name)).toEqual(['Fruit & vegetables', 'Dairy & eggs', 'Household', 'Other']);
    expect(titles(view.sections[3]!.items)).toEqual(['Thing', 'Odd']);
  });

  it('lists ticked items under Recent, latest first, once each, unless back on the list', () => {
    const view = groceryView(
      [
        g('milk', null, { status: 'done', updatedAt: '2026-11-26T10:00:00.000Z' }),
        g('Milk', null, { status: 'done', updatedAt: '2026-11-20T10:00:00.000Z' }),
        g('bread', null, { status: 'done', updatedAt: '2026-11-26T11:00:00.000Z' }),
        g('eggs', null, { status: 'done', updatedAt: '2026-11-26T09:00:00.000Z' }),
        g('eggs', null),
      ],
      DEFAULT_SETTINGS,
    );
    expect(titles(view.recent)).toEqual(['Bread', 'Milk']);
  });

  it('labels quantities', () => {
    expect(groceryLabel(g('melk', 'Dairy & eggs'))).toBe('melk');
    expect(groceryLabel(item('g melk', { grocery: { canonicalName: 'milk', displayName: 'melk', quantity: 2, section: 'Dairy & eggs' } }))).toBe('melk × 2');
  });
});
