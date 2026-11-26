// The on-device quick parser. Deterministic, no network: it handles list prefixes
// and explicit relative times ("in 10 min", "over een kwartier") in Dutch and
// English, so a reminder exists the instant enter is pressed. Everything subtler
// (vague times, dates, splitting, groceries) is the LLM's job on the server.
import type { ListId } from './types';

export interface ParsedCapture {
  /** List forced by a prefix, or null when there was none. */
  list: ListId | null;
  title: string;
  /** UTC ISO time, rounded to the minute, or null. */
  remindAt: string | null;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, een: 1, 'één': 1,
  two: 2, twee: 2, three: 3, drie: 3, four: 4, vier: 4, five: 5, vijf: 5,
  six: 6, zes: 6, seven: 7, zeven: 7, eight: 8, acht: 8, nine: 9, negen: 9,
  ten: 10, tien: 10, eleven: 11, elf: 11, twelve: 12, twaalf: 12,
  fifteen: 15, vijftien: 15, twenty: 20, twintig: 20, thirty: 30, dertig: 30,
  'forty-five': 45, vijfenveertig: 45,
};

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const WORD = Object.keys(NUMBER_WORDS).join('|');
const MIN = String.raw`min(?:ute|uten|utes|uut|uutje|uutjes|s)?\.?`;
const HOUR = String.raw`h(?:ours?|rs?)?|u(?:ur|ren|urtje)?`;
const QUARTER = String.raw`kwartier(?:tje)?|quarters?(?:\s+of\s+an\s+hour)?`;
// A quantity: digits may touch the unit ("10m"), a number word needs a space ("een uur").
const Q = String.raw`(?:(${NUM})\s*|(${WORD})\s+)`;
// "in" and "over" both occur in Dutch; English uses "in".
const LEAD = String.raw`(?<![\p{L}\p{N}])(?:in|over)\s+(?:about\s+|around\s+|ongeveer\s+|circa\s+|zo'n\s+)?`;
const END = String.raw`(?![\p{L}\p{N}])`;

interface Rule {
  re: RegExp;
  minutes: (m: RegExpExecArray) => number | null;
}

function quantity(digits: string | undefined, word: string | undefined): number | null {
  if (digits) return Number(digits.replace(',', '.'));
  if (word) return NUMBER_WORDS[word.toLowerCase()] ?? null;
  return null;
}

const rx = (body: string): RegExp => new RegExp(LEAD + body + END, 'iu');

// Most specific first.
const RULES: Rule[] = [
  // "anderhalf uur", "an hour and a half", "one and a half hours"
  { re: rx(String.raw`(?:anderhalf\s+uur|an?\s+hour\s+and\s+a\s+half|one\s+and\s+a\s+half\s+hours?)`), minutes: () => 90 },
  // "2 uur en 15 minuten", "1 hour and 30 min"
  {
    re: rx(String.raw`${Q}(?:${HOUR})\s*(?:(?:en|and)\s+)?${Q}(?:${MIN}|m)`),
    minutes: (m) => {
      const h = quantity(m[1], m[2]);
      const min = quantity(m[3], m[4]);
      return h === null || min === null ? null : h * 60 + min;
    },
  },
  // "een half uur", "half uurtje", "halfuur", "half an hour", "a half hour"
  { re: rx(String.raw`(?:(?:een|a)\s+)?half\s*(?:an\s+)?(?:uur(?:tje)?|hour)`), minutes: () => 30 },
  // "een kwartier", "3 kwartier", "a quarter of an hour"
  {
    re: rx(String.raw`(?:(?:(${NUM})|(${WORD}))\s+)?(?:${QUARTER})`),
    minutes: (m) => (quantity(m[1], m[2]) ?? 1) * 15,
  },
  // "10 min", "10m", "tien minuten"
  { re: rx(String.raw`${Q}(?:${MIN}|m)`), minutes: (m) => quantity(m[1], m[2]) },
  // "2 uur", "2u", "2h", "an hour", "een uurtje"
  {
    re: rx(String.raw`${Q}(?:${HOUR})`),
    minutes: (m) => {
      const q = quantity(m[1], m[2]);
      return q === null ? null : q * 60;
    },
  },
];

const MAX_MINUTES = 366 * 24 * 60;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits a leading list prefix ("w ", "p ", "g ") off the text. */
export function splitPrefix(text: string, prefixes: Record<ListId, string>): { list: ListId | null; rest: string } {
  const trimmed = text.trim();
  for (const list of Object.keys(prefixes) as ListId[]) {
    const prefix = prefixes[list]?.trim();
    if (!prefix) continue;
    const m = new RegExp(`^${escapeRegExp(prefix)}\\s+(\\S[\\s\\S]*)$`, 'i').exec(trimmed);
    if (m?.[1]) return { list, rest: m[1].trim() };
  }
  return { list: null, rest: trimmed };
}

function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.\-–]+|[\s,;:\-–]+$/g, '')
    .trim();
}

/** Rounds to the nearest minute, so the time shown is the time the reminder fires. */
export function roundToMinute(ms: number): number {
  return Math.round(ms / 60_000) * 60_000;
}

export function parseCapture(text: string, capturedAt: Date, prefixes: Record<ListId, string>): ParsedCapture {
  const { list, rest } = splitPrefix(text, prefixes);
  for (const rule of RULES) {
    const m = rule.re.exec(rest);
    if (!m) continue;
    const minutes = rule.minutes(m);
    if (minutes === null || !(minutes > 0) || minutes > MAX_MINUTES) continue;
    const remindAt = new Date(roundToMinute(capturedAt.getTime() + minutes * 60_000)).toISOString();
    const title = tidy(rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length));
    return { list, title: title || rest, remindAt };
  }
  return { list, title: rest, remindAt: null };
}
