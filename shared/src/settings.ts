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
  notificationButtons: [string, string];
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
  notificationButtons: ['done', 'snooze-1h'],
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

/** Fills gaps in stored settings with defaults, so adding a setting later never breaks old data. */
export function withDefaults(stored: unknown): Settings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Settings>;
  const d = DEFAULT_SETTINGS;
  return {
    ...d,
    ...s,
    vagueTimes: { ...d.vagueTimes, ...s.vagueTimes },
    digest: { ...d.digest, ...s.digest },
    fading: { ...d.fading, ...s.fading },
    prefixes: { ...d.prefixes, ...s.prefixes },
    llm: { ...d.llm, ...s.llm },
  };
}
