import { describe, expect, it } from 'vitest';
import { isLate, reminderPayload } from '../src/notify';
import { DEFAULT_SETTINGS } from '../src/settings';
import { actionLabel, atLocalTime, resolveSnooze, snoozeLabel } from '../src/snooze';

const S = DEFAULT_SETTINGS; // Europe/Amsterdam, morning 07:45, evening 20:00
const at = (iso: string) => new Date(iso);
const snooze = (preset: string, now: string) => resolveSnooze(preset, at(now), S)?.toISOString() ?? null;

describe('vague times map to the settings', () => {
  it('uses the configured clock times in the configured zone', () => {
    expect(atLocalTime('2026-11-27', S.vagueTimes.morning, S.timeZone).toISOString()).toBe('2026-11-27T06:45:00.000Z');
    expect(atLocalTime('2026-07-01', S.vagueTimes.morning, S.timeZone).toISOString()).toBe('2026-07-01T05:45:00.000Z');
    expect(atLocalTime('2026-11-27', S.vagueTimes.afternoon, S.timeZone).toISOString()).toBe('2026-11-27T12:00:00.000Z');
    expect(atLocalTime('2026-11-27', S.vagueTimes.evening, S.timeZone).toISOString()).toBe('2026-11-27T19:00:00.000Z');
  });

  it('follows changed settings', () => {
    const mine = { ...S, timeZone: 'America/New_York', vagueTimes: { ...S.vagueTimes, morning: '06:30' } };
    expect(resolveSnooze('tomorrow-morning', at('2026-11-27T15:00:00Z'), mine)?.toISOString()).toBe('2026-11-28T11:30:00.000Z');
  });
});

describe('resolveSnooze', () => {
  it('+1 hour counts from now and rounds to the minute', () => {
    expect(snooze('1h', '2026-11-27T12:46:20.000Z')).toBe('2026-11-27T13:46:00.000Z');
    expect(snooze('15m', '2026-11-27T12:46:40.000Z')).toBe('2026-11-27T13:02:00.000Z');
    expect(snooze('3h', '2026-11-27T12:00:00.000Z')).toBe('2026-11-27T15:00:00.000Z');
  });

  it('tonight is today at the evening time', () => {
    expect(snooze('tonight', '2026-11-27T12:46:00.000Z')).toBe('2026-11-27T19:00:00.000Z');
  });

  it('tonight after the evening time is tomorrow evening, never the past', () => {
    expect(snooze('tonight', '2026-11-27T19:00:00.000Z')).toBe('2026-11-28T19:00:00.000Z');
    expect(snooze('tonight', '2026-11-27T21:30:00.000Z')).toBe('2026-11-28T19:00:00.000Z');
  });

  it('tomorrow morning is tomorrow at the morning time, by the local date', () => {
    expect(snooze('tomorrow-morning', '2026-11-27T12:46:00.000Z')).toBe('2026-11-28T06:45:00.000Z');
    // 00:30 local on the 28th is still the 27th in UTC: "tomorrow" is the 29th.
    expect(snooze('tomorrow-morning', '2026-11-27T23:30:00.000Z')).toBe('2026-11-29T06:45:00.000Z');
  });

  it('is right across the spring clock change (07:45 stays 07:45)', () => {
    // Sat 28 Mar 2026 22:00 CET → Sun 29 Mar 07:45 CEST = 05:45Z
    expect(snooze('tomorrow-morning', '2026-03-28T21:00:00.000Z')).toBe('2026-03-29T05:45:00.000Z');
    // +1 hour across the gap is still exactly 60 minutes
    expect(snooze('1h', '2026-03-29T00:30:00.000Z')).toBe('2026-03-29T01:30:00.000Z');
  });

  it('is right across the autumn clock change', () => {
    // Sat 24 Oct 2026 22:00 CEST → Sun 25 Oct 07:45 CET = 06:45Z
    expect(snooze('tomorrow-morning', '2026-10-24T20:00:00.000Z')).toBe('2026-10-25T06:45:00.000Z');
    expect(snooze('tonight', '2026-10-25T08:00:00.000Z')).toBe('2026-10-25T19:00:00.000Z');
  });

  it('rejects unknown presets', () => {
    expect(snooze('someday', '2026-11-27T12:00:00.000Z')).toBeNull();
    expect(snooze('0m', '2026-11-27T12:00:00.000Z')).toBeNull();
  });
});

describe('labels', () => {
  it('names presets and buttons', () => {
    expect(snoozeLabel('1h')).toBe('+1 hour');
    expect(snoozeLabel('3h')).toBe('+3 hours');
    expect(snoozeLabel('15m')).toBe('+15 min');
    expect(snoozeLabel('tonight')).toBe('Tonight');
    expect(actionLabel('done')).toBe('Done');
    expect(actionLabel('snooze:1h')).toBe('Snooze 1h');
    expect(actionLabel('snooze:tomorrow-morning')).toBe('Tomorrow morning');
  });
});

describe('reminder notification', () => {
  const item = { id: 'abc', title: 'oven uit', list: 'personal' as const, remindAt: '2026-11-27T13:13:00.000Z' };

  it('shows the title, time, list and the two configured buttons', () => {
    expect(reminderPayload(item, at('2026-11-27T13:13:05.000Z'), S)).toEqual({
      kind: 'reminder',
      title: 'oven uit',
      body: '⏰ 14:13 · Personal',
      tag: 'item-abc',
      itemId: 'abc',
      actions: [
        { action: 'done', title: 'Done' },
        { action: 'snooze:1h', title: 'Snooze 1h' },
      ],
    });
  });

  it('is marked late when it goes out well after its time', () => {
    expect(isLate(item.remindAt, at('2026-11-27T13:14:00.000Z'))).toBe(false);
    expect(isLate(item.remindAt, at('2026-11-27T13:15:00.000Z'))).toBe(true);
    expect(reminderPayload(item, at('2026-11-27T15:00:00.000Z'), S).body).toBe('Late · was due 14:13 · Personal');
    expect(reminderPayload(item, at('2026-11-28T08:00:00.000Z'), S).body).toBe('Late · was due yesterday 14:13 · Personal');
  });
});
