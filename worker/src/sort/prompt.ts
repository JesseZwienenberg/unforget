// The sorting prompt. The system part is fixed (and cacheable); everything that
// changes per capture (date, settings, the text) goes in the user message.
import type { Settings } from '../../../shared/src/settings';
import { addDays, localDate, offsetMs, toWallTime } from '../../../shared/src/time';
import type { ListId } from '../../../shared/src/types';

export const MODEL = 'claude-haiku-5-5';
export const TOOL_NAME = 'file_items';

export const SYSTEM_PROMPT = `You file quick personal notes for one person, Jesse. He types short captures on his phone in Dutch, in English, or in both mixed within one sentence. Turn one capture into items and call the ${TOOL_NAME} tool exactly once.

## Steps

1. Split. Make separate items when the capture clearly holds several things: a list of groceries ("melk, brood en eieren"), or unrelated tasks. One task stays one item, even if it contains "en" or "and" ("bellen en afspraak maken met de tandarts" is one item). When in doubt, do not split.

2. List. Pick one per item:
   - groceries: something to buy in a supermarket or drugstore (food, drinks, household products, personal care).
   - work: anything about his job: colleagues, meetings, clients, reports, presentations, deadlines, code, the office.
   - personal: everything else: home, family, friends, health, errands, money, hobbies, things to watch or read.
   If the user message gives a fixed list, use it for every item.

3. Title. Short and clean, in the words and language Jesse used. Never translate. Fix obvious typos. Drop filler ("herinner me eraan dat ik", "niet vergeten", "remind me to", "don't forget to") and drop the time words you turned into remindAt or dueAt. Keep names, places and details, and keep his capitalisation (the app capitalises the first letter itself).

4. Times. Everything is relative to the capture time in the user message; use its calendar for weekdays and dates.
   - remindAt = the moment Jesse wants to be notified or wants to do the thing: "morgen om 9 uur bellen", "vanavond", "at 3pm", "vrijdag", "herinner me zaterdag".
   - dueAt = a deadline, the latest moment something must be finished: "voor vrijdag", "uiterlijk 1 december", "deadline maandag", "by Friday", "due next week". Use a date only (YYYY-MM-DD) unless he gave a clock time.
   - An item may have one, both or neither. No time words means both are null. Never invent a time.
   - Write remindAt as local wall-clock time in his time zone with the offset from the user message, like 2026-11-27T09:00:00+01:00.
   - A day without a clock time, used as a reminder ("morgen", "tomorrow", "vrijdag", "next Monday") = that day at the morning time.
   - Vague parts of the day use the clock times from the user message: morning (ochtend, 's ochtends, morgenochtend, vanochtend), afternoon (middag, 's middags, vanmiddag, morgenmiddag), evening (avond, 's avonds, vanavond, tonight, morgenavond). "dit weekend" / "this weekend" = the coming Saturday at the weekend time.
   - A weekday name means the next such day after the capture day. "volgende week" / "next week" without a day = Monday of next week.
   - Ambiguous clock times ("om 3 uur", "kwart over 2", "at 7") = the nearest future time between 07:00 and 22:59.
   - Dutch "half N" is thirty minutes BEFORE N o'clock: "half 4" is 3:30, "half 5" is 4:30, "half 9" is 8:30. When the user message has clock hints, follow them.
   - If the user message has a device reminder, the phone already computed a relative time ("over 10 minuten", "in an hour"): copy it exactly into remindAt for the item it belongs to.

5. Groceries. For every groceries item fill "grocery":
   - canonicalName: the generic product in English, lowercase, singular, used to recognise duplicates across languages: "melk" and "milk" are both "milk"; "eieren" is "egg"; "pindakaas" is "peanut butter". Keep a brand or variety only when it is the point ("cola zero" is "cola zero").
   - displayName: what Jesse wrote, cleaned, without the quantity.
   - quantity: the number of units if he gave one ("2 pakken melk" is 2, "3 bananen" is 3), otherwise null. Weights and volumes ("500 gram gehakt") stay in displayName and quantity is null.
   - section: exactly one of the section names in the user message.
   The item's title equals displayName. For other lists "grocery" is null.

6. Confidence. A number from 0 to 1 for how sure you are about the list and the split. Use less than 0.6 when you are guessing, for example a single unclear word.

## Examples

Capture day in these examples: Thursday 2026-11-26, 14:03, offset +01:00. Vague times: morning 07:45, afternoon 13:00, evening 20:00, weekend 10:00.

"melk, brood en 6 eieren" →
[{"title":"melk","list":"groceries","remindAt":null,"dueAt":null,"grocery":{"canonicalName":"milk","displayName":"melk","quantity":null,"section":"Dairy & eggs"},"confidence":0.97},
 {"title":"brood","list":"groceries","remindAt":null,"dueAt":null,"grocery":{"canonicalName":"bread","displayName":"brood","quantity":null,"section":"Bread & bakery"},"confidence":0.97},
 {"title":"eieren","list":"groceries","remindAt":null,"dueAt":null,"grocery":{"canonicalName":"egg","displayName":"eieren","quantity":6,"section":"Dairy & eggs"},"confidence":0.97}]

"morgenochtend tandarts bellen voor afspraak" →
[{"title":"tandarts bellen voor afspraak","list":"personal","remindAt":"2026-11-27T07:45:00+01:00","dueAt":null,"grocery":null,"confidence":0.93}]

"send Q4 report to Anna before Friday" →
[{"title":"send Q4 report to Anna","list":"work","remindAt":null,"dueAt":"2026-11-27","grocery":null,"confidence":0.92}]

"vanavond de was ophangen en remind me zaterdag to call oma" →
[{"title":"de was ophangen","list":"personal","remindAt":"2026-11-26T20:00:00+01:00","dueAt":null,"grocery":null,"confidence":0.9},
 {"title":"call oma","list":"personal","remindAt":"2026-11-28T07:45:00+01:00","dueAt":null,"grocery":null,"confidence":0.9}]

"standup notes sturen" with device reminder 2026-11-26T16:03:00+01:00 →
[{"title":"standup notes sturen","list":"work","remindAt":"2026-11-26T16:03:00+01:00","dueAt":null,"grocery":null,"confidence":0.85}]

"half 5 kids ophalen van zwemles" →
[{"title":"kids ophalen van zwemles","list":"personal","remindAt":"2026-11-26T16:30:00+01:00","dueAt":null,"grocery":null,"confidence":0.93}]

"presentatie klant X afmaken, deadline maandag, en dinsdag om 10 uur meeting met Pieter" →
[{"title":"presentatie klant X afmaken","list":"work","remindAt":null,"dueAt":"2026-11-30","grocery":null,"confidence":0.92},
 {"title":"meeting met Pieter","list":"work","remindAt":"2026-12-01T10:00:00+01:00","dueAt":null,"grocery":null,"confidence":0.92}]

"2 cola zero and wc papier" →
[{"title":"cola zero","list":"groceries","remindAt":null,"dueAt":null,"grocery":{"canonicalName":"cola zero","displayName":"cola zero","quantity":2,"section":"Drinks"},"confidence":0.95},
 {"title":"wc papier","list":"groceries","remindAt":null,"dueAt":null,"grocery":{"canonicalName":"toilet paper","displayName":"wc papier","quantity":null,"section":"Household"},"confidence":0.95}]

"dit weekend fiets band plakken" →
[{"title":"fiets band plakken","list":"personal","remindAt":"2026-11-28T10:00:00+01:00","dueAt":null,"grocery":null,"confidence":0.92}]

"Dune 2 kijken" →
[{"title":"Dune 2 kijken","list":"personal","remindAt":null,"dueAt":null,"grocery":null,"confidence":0.85}]

"blauw" →
[{"title":"blauw","list":"personal","remindAt":null,"dueAt":null,"grocery":null,"confidence":0.2}]`;

const nullable = (type: string, description: string) => ({ type: [type, 'null'], description });

export const TOOL = {
  name: TOOL_NAME,
  description: 'Store the items extracted from one capture.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'One entry per separate thing in the capture, in the order written.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: "Clean, short title in Jesse's own language." },
            list: { type: 'string', enum: ['work', 'personal', 'groceries'] },
            remindAt: nullable('string', 'Local wall-clock time with offset, e.g. 2026-11-27T09:00:00+01:00, or null.'),
            dueAt: nullable('string', 'Deadline as YYYY-MM-DD (or local time with offset if a clock time was given), or null.'),
            grocery: {
              type: ['object', 'null'],
              description: 'Only for groceries items; null otherwise.',
              properties: {
                canonicalName: { type: 'string' },
                displayName: { type: 'string' },
                quantity: { type: ['number', 'null'] },
                section: { type: 'string' },
              },
              required: ['canonicalName', 'displayName', 'quantity', 'section'],
            },
            confidence: { type: 'number', description: '0 to 1.' },
          },
          required: ['title', 'list', 'remindAt', 'dueAt', 'grocery', 'confidence'],
        },
      },
    },
    required: ['items'],
  },
} as const;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

export function formatOffset(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const minutes = Math.abs(ms) / 60_000;
  return `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** A moment as local wall-clock time with offset: the format the model reads and writes. */
export function toLocalIso(date: Date, timeZone: string): string {
  const w = toWallTime(date, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:00${formatOffset(offsetMs(date, timeZone))}`;
}

function weekday(isoDate: string): string {
  const [y = 0, m = 1, d = 1] = isoDate.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

const HOUR_WORDS: Record<string, number> = {
  een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12,
};
const HOUR = String.raw`(\d{1,2}|${Object.keys(HOUR_WORDS).join('|')})`;

/**
 * Dutch clock phrases the model tends to misread ("half 4" is 3:30, not 4:30),
 * spelled out by code so it does not have to work them out.
 */
export function dutchClockHints(text: string): string[] {
  const hints: string[] = [];
  const hourOf = (raw: string) => HOUR_WORDS[raw.toLowerCase()] ?? Number(raw);
  const on12 = (h: number) => ((h + 11) % 12) + 1;
  const add = (phrase: string, hour: number, minute: string) => {
    if (hour >= 1 && hour <= 12) hints.push(`"${phrase.trim()}" means ${on12(hour)}:${minute} (so ${on12(hour)}:${minute} or ${on12(hour) === 12 ? 0 : on12(hour) + 12}:${minute})`);
  };
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}])half\s+${HOUR}(?![\p{L}\p{N}:.])`, 'giu'))) add(m[0], hourOf(m[1]!) - 1 || 12, '30');
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}])kwart\s+voor\s+${HOUR}(?![\p{L}\p{N}:.])`, 'giu'))) add(m[0], hourOf(m[1]!) - 1 || 12, '45');
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}])kwart\s+over\s+${HOUR}(?![\p{L}\p{N}:.])`, 'giu'))) add(m[0], hourOf(m[1]!), '15');
  return hints;
}

export interface PromptInput {
  /** The capture text without its list prefix. */
  text: string;
  capturedAt: Date;
  settings: Settings;
  /** Set when a prefix (w/p/g) fixed the list. */
  fixedList: ListId | null;
  /** The reminder the phone already parsed from a relative time, if any. */
  deviceRemindAt: string | null;
}

export function buildUserMessage(input: PromptInput): string {
  const { settings, capturedAt } = input;
  const tz = settings.timeZone;
  const today = localDate(capturedAt, tz);
  const w = toWallTime(capturedAt, tz);
  // A two-week calendar, so the model reads weekdays off a list instead of calculating them.
  const calendar = Array.from({ length: 15 }, (_, i) => {
    const day = addDays(today, i);
    return `${weekday(day)} ${day}${i === 0 ? ' (capture day)' : i === 1 ? ' (tomorrow)' : ''}`;
  }).join('\n');
  const v = settings.vagueTimes;
  return [
    `Capture time: ${weekday(today)} ${today}, ${pad(w.hour)}:${pad(w.minute)} (${tz}, offset ${formatOffset(offsetMs(capturedAt, tz))})`,
    `Calendar:\n${calendar}`,
    `Vague times: morning ${v.morning}, afternoon ${v.afternoon}, evening ${v.evening}, weekend Saturday ${v.weekend}`,
    `Grocery sections: ${settings.grocerySections.join(' | ')}`,
    `Fixed list: ${input.fixedList ?? 'none'}`,
    `Device reminder: ${input.deviceRemindAt ? toLocalIso(new Date(input.deviceRemindAt), tz) : 'none'}`,
    `Clock hints: ${dutchClockHints(input.text).join('; ') || 'none'}`,
    `Capture:\n<capture>\n${input.text}\n</capture>`,
  ].join('\n\n');
}

export function buildRequest(input: PromptInput): Record<string, unknown> {
  return {
    model: MODEL,
    max_tokens: 1500,
    // No temperature: Anthropic's documentation says to omit sampling parameters for this model.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [TOOL],
    // Forced tool: the answer is always a tool call with JSON input, never prose.
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: buildUserMessage(input) }],
  };
}
