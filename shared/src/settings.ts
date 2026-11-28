import type { ListId } from './types';

export interface Settings {
  timeZone: string;
  vagueTimes: {
    morning: string;
    afternoon: string;
    evening: string;
    /** "this weekend": Saturday at this time. */
    weekend: string;
  };
  digest: { time: string; days: number[] };
  /** Days until an untouched item is archived; null = never. */
  fading: { personalDays: number | null; workDays: number | null; overdueDays: number | null; groceriesDays: number | null };
  /** Two buttons on each reminder notification: 'done' or 'snooze:<preset>'. */
  notificationButtons: [string, string];
  /** Presets offered in the snooze sheet: '<n>m', '<n>h', 'tonight', 'tomorrow-morning'. */
  snoozePresets: string[];
  prefixes: Record<ListId, string>;
  grocerySections: string[];
  llm: { enabled: boolean; dailyCap: number };
}

export const DEFAULT_SETTINGS: Settings = {
  timeZone: 'Europe/Amsterdam',
  vagueTimes: { morning: '07:45', afternoon: '13:00', evening: '20:00', weekend: '10:00' },
  digest: { time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] },
  fading: { personalDays: 14, workDays: 30, overdueDays: 7, groceriesDays: null },
  notificationButtons: ['done', 'snooze:1h'],
  snoozePresets: ['1h', 'tonight', 'tomorrow-morning'],
  prefixes: { work: 'w', personal: 'p', groceries: 'g' },
  grocerySections: [
    'Fruit & vegetables',
    'Bread & bakery',
    'Dairy & eggs',
    'Cheese & deli',
    'Meat & fish',
    'Frozen',
    'Pantry',
    'Drinks',
    'Snacks',
    'Household',
    'Personal care',
    'Other',
  ],
  llm: { enabled: true, dailyCap: 300 },
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export const SNOOZE_PRESET = /^(?:[1-9]\d{0,2}[mh]|tonight|tomorrow-morning)$/;
export const KNOWN_PRESETS = ['15m', '30m', '1h', '3h', 'tonight', 'tomorrow-morning'] as const;

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isAction(value: unknown): value is string {
  return value === 'done' || (typeof value === 'string' && value.startsWith('snooze:') && SNOOZE_PRESET.test(value.slice(7)));
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const clock = (v: unknown, fallback: string): string => (typeof v === 'string' && CLOCK.test(v) ? v : fallback);
const days = (v: unknown, fallback: number | null): number | null =>
  v === null ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 3650 ? v : fallback;
const word = (v: unknown, fallback: string): string => (typeof v === 'string' && /^\S{1,12}$/.test(v.trim()) ? v.trim() : fallback);

/**
 * Stored settings → valid settings. Anything missing or malformed falls back to
 * its default, so old data, a newer app version or a bad sync can never break a device.
 */
export function withDefaults(stored: unknown): Settings {
  const s = rec(stored);
  const d = DEFAULT_SETTINGS;
  const vague = rec(s.vagueTimes);
  const digest = rec(s.digest);
  const fading = rec(s.fading);
  const prefixes = rec(s.prefixes);
  const llm = rec(s.llm);
  const buttons = Array.isArray(s.notificationButtons) && s.notificationButtons.length === 2 && s.notificationButtons.every(isAction) ? s.notificationButtons : d.notificationButtons;
  const presets = Array.isArray(s.snoozePresets) ? s.snoozePresets.filter((p): p is string => typeof p === 'string' && SNOOZE_PRESET.test(p)) : [];
  const sections = Array.isArray(s.grocerySections)
    ? [...new Set(s.grocerySections.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x && x.length <= 40))].slice(0, 40)
    : [];
  const digestDays = Array.isArray(digest.days) ? [...new Set(digest.days.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : d.digest.days;
  const p = { work: word(prefixes.work, d.prefixes.work), personal: word(prefixes.personal, d.prefixes.personal), groceries: word(prefixes.groceries, d.prefixes.groceries) };
  const distinct = new Set(Object.values(p).map((x) => x.toLowerCase())).size === 3;
  return {
    timeZone: isTimeZone(s.timeZone) ? s.timeZone : d.timeZone,
    vagueTimes: {
      morning: clock(vague.morning, d.vagueTimes.morning),
      afternoon: clock(vague.afternoon, d.vagueTimes.afternoon),
      evening: clock(vague.evening, d.vagueTimes.evening),
      weekend: clock(vague.weekend, d.vagueTimes.weekend),
    },
    digest: { time: clock(digest.time, d.digest.time), days: digestDays },
    fading: {
      personalDays: days(fading.personalDays, d.fading.personalDays),
      workDays: days(fading.workDays, d.fading.workDays),
      overdueDays: days(fading.overdueDays, d.fading.overdueDays),
      groceriesDays: days(fading.groceriesDays, d.fading.groceriesDays),
    },
    notificationButtons: [buttons[0] as string, buttons[1] as string],
    snoozePresets: presets.length ? [...new Set(presets)].slice(0, 6) : d.snoozePresets,
    prefixes: distinct ? p : d.prefixes,
    grocerySections: sections.length ? sections : d.grocerySections,
    llm: {
      enabled: typeof llm.enabled === 'boolean' ? llm.enabled : d.llm.enabled,
      dailyCap: typeof llm.dailyCap === 'number' && Number.isInteger(llm.dailyCap) && llm.dailyCap >= 0 && llm.dailyCap <= 5000 ? llm.dailyCap : d.llm.dailyCap,
    },
  };
}

/** Problems a person should fix before saving (the settings screen shows these). Empty = fine. */
export function settingsProblems(s: Settings): string[] {
  const problems: string[] = [];
  if (!isTimeZone(s.timeZone)) problems.push('Time zone is not a known zone (example: Europe/Amsterdam).');
  for (const [name, value] of Object.entries({ ...s.vagueTimes, digest: s.digest.time })) {
    if (!CLOCK.test(value)) problems.push(`The ${name} time must look like 07:45.`);
  }
  const p = Object.values(s.prefixes).map((x) => x.trim().toLowerCase());
  if (p.some((x) => !/^\S{1,12}$/.test(x))) problems.push('Each prefix must be 1 to 12 characters without spaces.');
  else if (new Set(p).size !== 3) problems.push('The three prefixes must be different.');
  if (!s.grocerySections.some((x) => x.trim())) problems.push('Keep at least one grocery section.');
  for (const [name, value] of Object.entries(s.fading)) {
    if (value !== null && !(Number.isFinite(value) && value >= 0 && value <= 3650)) problems.push(`Fading "${name}" must be a number of days, or empty for never.`);
  }
  if (!(Number.isInteger(s.llm.dailyCap) && s.llm.dailyCap >= 0 && s.llm.dailyCap <= 5000)) problems.push('The daily sorting limit must be a whole number from 0 to 5000.');
  if (!s.snoozePresets.length) problems.push('Keep at least one snooze option.');
  return problems;
}
