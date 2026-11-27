// Snooze presets and the two notification buttons. Used by the app (snooze sheet)
// and by the Worker (a button pressed on a notification), so both agree on times.
import type { Settings } from './settings';
import { roundToMinute } from './parse';
import { addDays, fromWallTime, localDate } from './time';

function parseClock(hhmm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : { hour: 9, minute: 0 };
}

/** The moment a local date + "HH:MM" setting refers to, in the user's time zone. */
export function atLocalTime(isoDate: string, hhmm: string, timeZone: string): Date {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  return fromWallTime({ year, month, day, ...parseClock(hhmm) }, timeZone);
}

/**
 * When a snooze preset fires.
 *  - "15m", "1h", "3h": that long from now, rounded to the minute
 *  - "tonight": today at the evening time; once that has passed, tomorrow evening
 *  - "tomorrow-morning": tomorrow at the morning time
 * Returns null for an unknown preset.
 */
export function resolveSnooze(preset: string, now: Date, settings: Settings): Date | null {
  const relative = /^(\d+)([mh])$/.exec(preset);
  if (relative) {
    const minutes = Number(relative[1]) * (relative[2] === 'h' ? 60 : 1);
    return minutes > 0 ? new Date(roundToMinute(now.getTime() + minutes * 60_000)) : null;
  }
  const today = localDate(now, settings.timeZone);
  if (preset === 'tonight') {
    const tonight = atLocalTime(today, settings.vagueTimes.evening, settings.timeZone);
    return tonight.getTime() > now.getTime() ? tonight : atLocalTime(addDays(today, 1), settings.vagueTimes.evening, settings.timeZone);
  }
  if (preset === 'tomorrow-morning') {
    return atLocalTime(addDays(today, 1), settings.vagueTimes.morning, settings.timeZone);
  }
  return null;
}

export function snoozeLabel(preset: string): string {
  const relative = /^(\d+)([mh])$/.exec(preset);
  if (relative) return `+${relative[1]} ${relative[2] === 'h' ? (relative[1] === '1' ? 'hour' : 'hours') : 'min'}`;
  if (preset === 'tonight') return 'Tonight';
  if (preset === 'tomorrow-morning') return 'Tomorrow morning';
  return preset;
}

/** Text on a notification button for an action id ('done' or 'snooze:<preset>'). */
export function actionLabel(action: string): string {
  if (action === 'done') return 'Done';
  const preset = snoozePreset(action);
  if (!preset) return action;
  const relative = /^(\d+)([mh])$/.exec(preset);
  return relative ? `Snooze ${relative[1]}${relative[2]}` : snoozeLabel(preset);
}

export function snoozePreset(action: string): string | null {
  return action.startsWith('snooze:') ? action.slice('snooze:'.length) : null;
}
