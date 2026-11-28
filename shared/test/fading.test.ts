import { describe, expect, it } from 'vitest';
import { createCapture } from '../src/capture';
import { digestContent, digestDue, digestPayload, nightlyDue } from '../src/digest';
import { fadesAt, fadingSoon, shouldFade } from '../src/fading';
import { DEFAULT_SETTINGS, settingsProblems, withDefaults, type Settings } from '../src/settings';
import type { Item } from '../src/types';

const S = DEFAULT_SETTINGS; // personal 14 days, work 30, overdue 7, groceries never
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const day = (d: number, hour = 12) => new Date(Date.UTC(2026, 10, d, hour)); // November 2026 (winter time)

function item(text: string, touchedDay: number, patch: Partial<Item> = {}): Item {
  return { ...createCapture(text, 'typed', day(touchedDay), S, newId).item, ...patch };
}
const fades = (i: Item, d: number, settings: Settings = S) => shouldFade(i, day(d), settings);

describe('fading rules', () => {
  it('undated Personal items fade 14 days after they were last touched', () => {
    const i = item('p ooit', 1);
    expect(fades(i, 14)).toBe(false);
    expect(fades(i, 15)).toBe(true);
    expect(fadesAt(i, S)).toEqual(day(15));
  });

  it('undated Work items fade after 30 days', () => {
    const i = item('w ooit', 1);
    expect(shouldFade(i, new Date(Date.UTC(2026, 10, 30, 12)), S)).toBe(false);
    expect(shouldFade(i, new Date(Date.UTC(2026, 11, 1, 12)), S)).toBe(true);
  });

  it('groceries never fade until ticked off', () => {
    expect(shouldFade(item('g melk', 1), new Date(Date.UTC(2028, 0, 1)), S)).toBe(false);
    expect(fadesAt(item('g melk', 1), S)).toBeNull();
  });

  it('overdue items fade 7 days after their time, not after they were made', () => {
    const reminder = item('p bellen', 1, { remindAt: day(10).toISOString() });
    expect(fades(reminder, 16)).toBe(false); // already 15 days old, but only 6 days overdue
    expect(fades(reminder, 17)).toBe(true);
  });

  it('a deadline counts until the end of its local day', () => {
    const due = item('w rapport', 1, { dueAt: '2026-11-10' });
    // The 10th ends at 23:00 UTC; 7 days later is the 17th at 23:00 UTC.
    expect(shouldFade(due, new Date(Date.UTC(2026, 10, 17, 22, 59)), S)).toBe(false);
    expect(shouldFade(due, new Date(Date.UTC(2026, 10, 17, 23, 1)), S)).toBe(true);
  });

  it('an item with a time still ahead never fades, however long ago it was made', () => {
    const far = item('p paspoort verlengen', 1, { remindAt: new Date(Date.UTC(2027, 5, 1)).toISOString() });
    expect(shouldFade(far, new Date(Date.UTC(2027, 4, 31)), S)).toBe(false);
    expect(shouldFade(far, new Date(Date.UTC(2027, 5, 9)), S)).toBe(true);
  });

  it('with a reminder and a deadline, the later one counts', () => {
    const both = item('w x', 1, { remindAt: day(5).toISOString(), dueAt: '2026-11-20' });
    expect(fades(both, 25)).toBe(false);
    expect(fades(both, 28)).toBe(true);
  });

  it('touching an item (snooze, edit, re-add) restarts its clock', () => {
    const edited = item('p ooit', 1, { touchedAt: day(10).toISOString() });
    expect(fades(edited, 15)).toBe(false);
    expect(fades(edited, 24)).toBe(true);
    // An overdue item that was edited after its time counts from the edit.
    const overdueEdited = item('p bellen', 1, { remindAt: day(5).toISOString(), touchedAt: day(11).toISOString() });
    expect(fades(overdueEdited, 13)).toBe(false);
    expect(fades(overdueEdited, 18)).toBe(true);
  });

  it('done, archived and deleted items are left alone', () => {
    expect(fades(item('p a', 1, { status: 'done' }), 28)).toBe(false);
    expect(fades(item('p b', 1, { status: 'archived' }), 28)).toBe(false);
    expect(fades(item('p c', 1, { deletedAt: day(2).toISOString() }), 28)).toBe(false);
  });

  it('follows the settings: other periods, never, and groceries on', () => {
    const mine: Settings = { ...S, fading: { personalDays: 3, workDays: null, overdueDays: null, groceriesDays: 10 } };
    expect(fades(item('p a', 1), 4, mine)).toBe(true);
    expect(shouldFade(item('w a', 1), new Date(Date.UTC(2030, 0, 1)), mine)).toBe(false);
    expect(shouldFade(item('p late', 1, { remindAt: day(2).toISOString() }), new Date(Date.UTC(2030, 0, 1)), mine)).toBe(false);
    expect(fades(item('g melk', 1), 11, mine)).toBe(true);
    expect(fades(item('p now', 1), 1, { ...S, fading: { ...S.fading, personalDays: 0 } })).toBe(true);
  });

  it('lists what fades within two days, soonest first', () => {
    const items = [item('p later', 5), item('p morgen', 2), item('p overmorgen', 3), item('p al weg', 1), item('g melk', 1)];
    // Now = the 16th at 00:00. Fading on: 19th, 16th 12:00, 17th 12:00, 15th (already), never.
    expect(fadingSoon(items, day(16, 0), S).map((i) => i.title)).toEqual(['Morgen', 'Overmorgen']);
  });
});

describe('morning digest', () => {
  const now = new Date('2026-11-27T07:00:00.000Z'); // Friday 08:00 local

  it('reports reminders today, due today, overdue and fading soon', () => {
    const items = [
      item('p garage bellen', 26, { remindAt: '2026-11-27T08:00:00.000Z' }),
      item('w declaraties indienen', 26, { dueAt: '2026-11-27' }),
      item('p oma bellen', 20, { remindAt: '2026-11-25T08:00:00.000Z' }),
      item('p bijna weg', 14, { touchedAt: '2026-11-14T12:00:00.000Z' }), // fades the 28th at noon
      item('p nog lang niet', 26),
      item('g melk', 1),
      item('p morgen pas', 26, { remindAt: '2026-11-28T08:00:00.000Z' }),
    ];
    const c = digestContent(items, now, S);
    expect([c.reminders.length, c.due.length, c.overdue.length, c.fading.length]).toEqual([1, 1, 1, 1]);
    expect(digestPayload(items, now, S)).toEqual({
      kind: 'digest',
      title: 'Today: 1 reminder · 1 due · 1 overdue · 1 fading soon',
      body: '⏰ 09:00 Garage bellen\nDue today: Declaraties indienen\nOverdue: Oma bellen\nFading soon: Bijna weg',
      tag: 'digest',
      itemId: null,
      actions: [],
    });
  });

  it('is not sent when there is nothing to say', () => {
    expect(digestPayload([item('p nog lang niet', 26), item('g melk', 1)], now, S)).toBeNull();
    expect(digestPayload([], now, S)).toBeNull();
  });

  it('does not list an overdue item twice when it is also fading', () => {
    const overdue = item('p oud', 1, { remindAt: '2026-11-21T08:00:00.000Z' }); // fades the 28th: overdue and fading soon
    const c = digestContent([overdue], now, S);
    expect([c.overdue.length, c.fading.length]).toEqual([1, 0]);
  });

  it('keeps a long digest short', () => {
    const many = Array.from({ length: 9 }, (_, k) => item(`p taak ${k}`, 26, { remindAt: `2026-11-27T${String(8 + k).padStart(2, '0')}:00:00.000Z` }));
    const payload = digestPayload(many, now, S)!;
    expect(payload.title).toBe('Today: 9 reminders');
    expect(payload.body.split('\n')).toHaveLength(6);
    expect(payload.body.split('\n')[5]).toBe('+ 4 more');
  });

  it('goes out at the configured local time on the configured days', () => {
    expect(digestDue(new Date('2026-11-27T06:59:00.000Z'), S)).toBeNull(); // 07:59
    expect(digestDue(new Date('2026-11-27T07:00:00.000Z'), S)).toBe('2026-11-27'); // 08:00
    expect(digestDue(new Date('2026-11-27T09:59:00.000Z'), S)).toBe('2026-11-27'); // late cron: still fine
    expect(digestDue(new Date('2026-11-27T10:00:00.000Z'), S)).toBeNull(); // 11:00: too late to be a morning digest
    const weekdays: Settings = { ...S, digest: { time: '07:30', days: [1, 2, 3, 4, 5] } };
    expect(digestDue(new Date('2026-11-27T06:30:00.000Z'), weekdays)).toBe('2026-11-27'); // Friday
    expect(digestDue(new Date('2026-11-28T06:30:00.000Z'), weekdays)).toBeNull(); // Saturday
  });

  it('stays at 08:00 local across both clock changes', () => {
    // Summer: 08:00 local = 06:00 UTC. Winter: 07:00 UTC.
    expect(digestDue(new Date('2026-03-28T07:00:00.000Z'), S)).toBe('2026-03-28');
    expect(digestDue(new Date('2026-03-29T05:59:00.000Z'), S)).toBeNull();
    expect(digestDue(new Date('2026-03-29T06:00:00.000Z'), S)).toBe('2026-03-29');
    expect(digestDue(new Date('2026-10-25T06:00:00.000Z'), S)).toBeNull();
    expect(digestDue(new Date('2026-10-25T07:00:00.000Z'), S)).toBe('2026-10-25');
  });

  it('the nightly clean-up is due from 03:00 local', () => {
    expect(nightlyDue(new Date('2026-11-27T01:59:00.000Z'), S)).toBeNull();
    expect(nightlyDue(new Date('2026-11-27T02:00:00.000Z'), S)).toBe('2026-11-27');
    expect(nightlyDue(new Date('2026-11-27T22:30:00.000Z'), S)).toBe('2026-11-27');
    expect(nightlyDue(new Date('2026-11-27T23:30:00.000Z'), S)).toBeNull(); // 00:30 on the 28th
  });
});

describe('settings validation', () => {
  it('accepts the defaults and round-trips them', () => {
    expect(settingsProblems(S)).toEqual([]);
    expect(withDefaults(JSON.parse(JSON.stringify(S)))).toEqual(S);
  });

  it('replaces malformed stored values with defaults, one field at a time', () => {
    const s = withDefaults({
      timeZone: 'Mars/Olympus',
      vagueTimes: { morning: '6:30', evening: '21:15' },
      digest: { time: 'noon', days: [1, 1, 9, 5] },
      fading: { personalDays: -1, workDays: null, overdueDays: 3 },
      notificationButtons: ['done', 'explode'],
      snoozePresets: ['2h', 'someday'],
      prefixes: { work: 'w', personal: 'w', groceries: 'g' },
      grocerySections: [' Groente ', '', 'Groente', 42],
      llm: { enabled: 'yes', dailyCap: 50 },
    });
    expect(s.timeZone).toBe('Europe/Amsterdam');
    expect(s.vagueTimes).toEqual({ morning: '07:45', afternoon: '13:00', evening: '21:15', weekend: '10:00' });
    expect(s.digest).toEqual({ time: '08:00', days: [1, 5] });
    expect(s.fading).toEqual({ personalDays: 14, workDays: null, overdueDays: 3, groceriesDays: null });
    expect(s.notificationButtons).toEqual(['done', 'snooze:1h']);
    expect(s.snoozePresets).toEqual(['2h']);
    expect(s.prefixes).toEqual(S.prefixes);
    expect(s.grocerySections).toEqual(['Groente']);
    expect(s.llm).toEqual({ enabled: true, dailyCap: 50 });
  });

  it('explains what to fix', () => {
    const bad: Settings = { ...S, timeZone: 'Nowhere', prefixes: { work: 'w', personal: 'w', groceries: 'g' }, grocerySections: [], llm: { enabled: true, dailyCap: 1.5 } };
    const problems = settingsProblems(bad);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toContain('Time zone');
  });
});
