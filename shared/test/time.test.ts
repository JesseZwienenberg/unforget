import { describe, expect, it } from 'vitest';
import { addDays, dueDate, formatDay, formatWhen, fromInputValue, fromWallTime, localDate, offsetMs, toInputValue, toWallTime } from '../src/time';

const TZ = 'Europe/Amsterdam';
const H = 3_600_000;

describe('time zone conversion', () => {
  it('knows winter and summer offsets', () => {
    expect(offsetMs(new Date('2026-01-15T12:00:00Z'), TZ)).toBe(1 * H);
    expect(offsetMs(new Date('2026-07-15T12:00:00Z'), TZ)).toBe(2 * H);
  });

  it('shows the right wall time on each side of the spring change', () => {
    expect(toWallTime(new Date('2026-03-29T00:59:00Z'), TZ)).toMatchObject({ hour: 1, minute: 59 });
    expect(toWallTime(new Date('2026-03-29T01:00:00Z'), TZ)).toMatchObject({ hour: 3, minute: 0 });
  });

  it('shows the right wall time on each side of the autumn change', () => {
    expect(toWallTime(new Date('2026-10-25T00:59:00Z'), TZ)).toMatchObject({ hour: 2, minute: 59 });
    expect(toWallTime(new Date('2026-10-25T01:00:00Z'), TZ)).toMatchObject({ hour: 2, minute: 0 });
  });

  it('turns wall time into the right moment in winter and summer', () => {
    expect(fromWallTime({ year: 2026, month: 1, day: 15, hour: 7, minute: 45 }, TZ).toISOString()).toBe('2026-01-15T06:45:00.000Z');
    expect(fromWallTime({ year: 2026, month: 7, day: 15, hour: 7, minute: 45 }, TZ).toISOString()).toBe('2026-07-15T05:45:00.000Z');
  });

  it('07:45 on the morning after each clock change is still 07:45', () => {
    expect(fromWallTime({ year: 2026, month: 3, day: 29, hour: 7, minute: 45 }, TZ).toISOString()).toBe('2026-03-29T05:45:00.000Z');
    expect(fromWallTime({ year: 2026, month: 10, day: 25, hour: 7, minute: 45 }, TZ).toISOString()).toBe('2026-10-25T06:45:00.000Z');
  });

  it('moves a time that does not exist (spring) forward by the gap', () => {
    // 02:30 on 29 Mar does not exist → 03:30 CEST
    expect(fromWallTime({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, TZ).toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it('takes the first of a time that happens twice (autumn)', () => {
    // 02:30 on 25 Oct happens at 00:30Z (CEST) and 01:30Z (CET)
    expect(fromWallTime({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, TZ).toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('round-trips datetime-local input values', () => {
    for (const iso of ['2026-01-15T06:45:00.000Z', '2026-07-15T21:59:00.000Z', '2026-03-29T01:30:00.000Z', '2026-12-31T23:30:00.000Z']) {
      expect(fromInputValue(toInputValue(iso, TZ), TZ)).toBe(iso);
    }
    expect(toInputValue('2026-12-31T23:30:00.000Z', TZ)).toBe('2027-01-01T00:30');
    expect(fromInputValue('nonsense', TZ)).toBeNull();
  });

  it('works for other zones', () => {
    expect(fromWallTime({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(fromWallTime({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, 'UTC').toISOString()).toBe('2026-07-01T09:00:00.000Z');
  });
});

describe('dates and labels', () => {
  const now = new Date('2026-11-26T13:00:00Z'); // Thu 26 Nov, 14:00 local

  it('finds the local date, including just after midnight', () => {
    expect(localDate(new Date('2026-11-26T22:59:00Z'), TZ)).toBe('2026-11-26');
    expect(localDate(new Date('2026-11-26T23:00:00Z'), TZ)).toBe('2026-11-27');
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('labels times', () => {
    expect(formatWhen('2026-11-26T13:13:00.000Z', TZ, now)).toBe('14:13');
    expect(formatWhen('2026-11-27T06:45:00.000Z', TZ, now)).toBe('tomorrow 07:45');
    expect(formatWhen('2026-11-25T19:00:00.000Z', TZ, now)).toBe('yesterday 20:00');
    expect(formatWhen('2026-12-04T09:00:00.000Z', TZ, now)).toBe('Fri 4 Dec 10:00');
    expect(formatWhen('2027-01-04T09:00:00.000Z', TZ, now)).toBe('Mon 4 Jan 2027 10:00');
  });

  it('labels days', () => {
    expect(formatDay('2026-11-26', '2026-11-26')).toBe('today');
    expect(formatDay('2026-11-28', '2026-11-26')).toBe('Sat 28 Nov');
  });

  it('reads a deadline as a local date', () => {
    expect(dueDate('2026-11-27', TZ)).toBe('2026-11-27');
    expect(dueDate('2026-11-27T23:30:00.000Z', TZ)).toBe('2026-11-28');
  });
});
