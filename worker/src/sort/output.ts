// Validates what the model returned, and turns it into safe values. The model is
// asked for a strict shape, but we never trust it: anything off fails the attempt.
import type { Settings } from '../../../shared/src/settings';
import { fromWallTime } from '../../../shared/src/time';
import { LISTS, type Grocery, type ListId } from '../../../shared/src/types';

export interface SortedItem {
  title: string;
  list: ListId;
  /** UTC ISO, or null. */
  remindAt: string | null;
  /** YYYY-MM-DD or UTC ISO, or null. */
  dueAt: string | null;
  grocery: Grocery | null;
  confidence: number;
}

export class InvalidOutput extends Error {}

const MAX_ITEMS = 25;
const MAX_TITLE = 300;
const LOCAL = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:?\d\d)?$/;
const DATE = /^(\d{4})-(\d\d)-(\d\d)$/;

const bad = (what: string): never => {
  throw new InvalidOutput(what);
};

function realDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * A time from the model → UTC. The wall-clock part is read in the user's time zone
 * and the offset the model wrote is ignored: models get daylight-saving offsets
 * wrong, but they get "09:00 on that day" right. An explicit Z is taken as real UTC.
 */
export function parseModelTime(value: string, timeZone: string): string {
  const m = LOCAL.exec(value.trim());
  if (!m) return bad(`time "${value}"`);
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  if (!realDate(year, month, day) || hour > 23 || minute > 59) return bad(`time "${value}"`);
  if (m[6] === 'Z') return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString();
  return fromWallTime({ year, month, day, hour, minute }, timeZone).toISOString();
}

function parseDue(value: string, timeZone: string): string {
  const d = DATE.exec(value.trim());
  if (d) {
    const [y, m, day] = d.slice(1).map(Number) as [number, number, number];
    return realDate(y, m, day) ? value.trim() : bad(`date "${value}"`);
  }
  return parseModelTime(value, timeZone);
}

function text(v: unknown, what: string, max = MAX_TITLE): string {
  if (typeof v !== 'string') return bad(what);
  const clean = v.replace(/\s+/g, ' ').trim();
  return clean && clean.length <= max ? clean : bad(what);
}

function grocery(v: unknown, settings: Settings): Grocery | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return bad('grocery');
  const g = v as Record<string, unknown>;
  const q = g.quantity;
  const sections = settings.grocerySections;
  const fallback = sections.includes('Other') ? 'Other' : (sections[sections.length - 1] ?? 'Other');
  return {
    canonicalName: text(g.canonicalName, 'grocery.canonicalName', 100).toLowerCase(),
    displayName: text(g.displayName, 'grocery.displayName', 200),
    quantity: q === null || q === undefined ? null : typeof q === 'number' && Number.isFinite(q) && q > 0 && q < 10_000 ? q : bad('grocery.quantity'),
    // An unknown section is a small mistake, not a failed sort.
    section: typeof g.section === 'string' && sections.includes(g.section) ? g.section : fallback,
  };
}

export function parseSortOutput(input: unknown, settings: Settings): SortedItem[] {
  if (!input || typeof input !== 'object') return bad('output');
  const items = (input as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length > MAX_ITEMS) return bad('items');
  return items.map((raw, i) => {
    if (!raw || typeof raw !== 'object') return bad(`items[${i}]`);
    const r = raw as Record<string, unknown>;
    const list = LISTS.includes(r.list as ListId) ? (r.list as ListId) : bad(`items[${i}].list`);
    const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : bad(`items[${i}].confidence`);
    const g = list === 'groceries' ? grocery(r.grocery, settings) : null;
    return {
      title: text(g?.displayName ?? r.title, `items[${i}].title`),
      list,
      remindAt: r.remindAt === null || r.remindAt === undefined ? null : typeof r.remindAt === 'string' ? parseModelTime(r.remindAt, settings.timeZone) : bad(`items[${i}].remindAt`),
      dueAt: r.dueAt === null || r.dueAt === undefined ? null : typeof r.dueAt === 'string' ? parseDue(r.dueAt, settings.timeZone) : bad(`items[${i}].dueAt`),
      grocery: g,
      confidence,
    };
  });
}

/** Pulls the forced tool call's input out of a Messages API response. */
export function extractToolInput(response: unknown, toolName: string): unknown {
  const content = (response as { content?: unknown })?.content;
  if (!Array.isArray(content)) return bad('response has no content');
  const block = content.find((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'tool_use' && (b as { name?: string }).name === toolName);
  return block ? (block as { input: unknown }).input : bad('response has no tool call');
}
