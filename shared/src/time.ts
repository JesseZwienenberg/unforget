// Time-zone helpers built on Intl, so daylight saving is the platform's job, not ours.

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock time that a moment has in a time zone. */
export function toWallTime(date: Date, timeZone: string): WallTime {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { year: out.year ?? 0, month: out.month ?? 0, day: out.day ?? 0, hour: out.hour ?? 0, minute: out.minute ?? 0 };
}

function asUtcMs(w: WallTime): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
}

function sameWall(a: WallTime, b: WallTime): boolean {
  return asUtcMs(a) === asUtcMs(b);
}

/** Offset (ms) of the zone at a moment: local = utc + offset. */
export function offsetMs(date: Date, timeZone: string): number {
  const floored = Math.floor(date.getTime() / 60_000) * 60_000;
  return asUtcMs(toWallTime(new Date(floored), timeZone)) - floored;
}

/**
 * The moment at which a zone's clocks show the given wall time.
 * Spring forward: a time that does not exist (02:30 on the last Sunday of March)
 * moves forward by the gap (to 03:30). Autumn: a time that happens twice is the first one.
 */
export function fromWallTime(wall: WallTime, timeZone: string): Date {
  const naive = asUtcMs(wall);
  const before = naive - offsetMs(new Date(naive - 12 * 3_600_000), timeZone);
  const after = naive - offsetMs(new Date(naive + 12 * 3_600_000), timeZone);
  const valid = [before, after].filter((ms) => sameWall(toWallTime(new Date(ms), timeZone), wall));
  return new Date(valid.length ? Math.min(...valid) : before);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** YYYY-MM-DD of a moment in a zone. */
export function localDate(date: Date, timeZone: string): string {
  const w = toWallTime(date, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number): string {
  const [y = 0, m = 1, d = 1] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Value for <input type="datetime-local">, in the given zone. */
export function toInputValue(iso: string, timeZone: string): string {
  const w = toWallTime(new Date(iso), timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** Reads an <input type="datetime-local"> value as wall time in the given zone. */
export function fromInputValue(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  return fromWallTime({ year, month, day, hour, minute }, timeZone).toISOString();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "today", "tomorrow", "yesterday" or "Fri 27 Nov" (with the year when it differs). */
export function formatDay(isoDate: string, today: string): string {
  if (isoDate === today) return 'today';
  if (isoDate === addDays(today, 1)) return 'tomorrow';
  if (isoDate === addDays(today, -1)) return 'yesterday';
  const [y = 0, m = 1, d = 1] = isoDate.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const year = isoDate.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`;
  return `${weekday} ${d} ${MONTHS[m - 1]}${year}`;
}

/** "14:13" today, otherwise "tomorrow 07:45" / "Fri 27 Nov 07:45". */
export function formatWhen(iso: string, timeZone: string, now: Date): string {
  const date = new Date(iso);
  const w = toWallTime(date, timeZone);
  const time = `${pad(w.hour)}:${pad(w.minute)}`;
  const day = localDate(date, timeZone);
  const today = localDate(now, timeZone);
  return day === today ? time : `${formatDay(day, today)} ${time}`;
}

/** The local date a deadline falls on (dueAt is a date or a UTC datetime). */
export function dueDate(dueAt: string, timeZone: string): string {
  return dueAt.length === 10 ? dueAt : localDate(new Date(dueAt), timeZone);
}
