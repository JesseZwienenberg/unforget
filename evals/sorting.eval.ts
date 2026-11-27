// Runs the eval set against the real Anthropic API and reports mismatches.
// Started by hand: the "Eval sorting" workflow, or locally with
//   ANTHROPIC_API_KEY=… npx vitest run --config vitest.eval.config.ts
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseCapture, splitPrefix } from '../shared/src/parse';
import { DEFAULT_SETTINGS } from '../shared/src/settings';
import { dueDate, toInputValue } from '../shared/src/time';
import { settle } from '../worker/src/sort/apply';
import { createSorter } from '../worker/src/sort/llm';
import { parseSortOutput } from '../worker/src/sort/output';
import { CAPTURED_AT, CASES, type EvalCase, type ExpectedItem } from './cases';

const S = DEFAULT_SETTINGS;
const PASS_RATE_NEEDED = 0.85;
const PARALLEL = 4;

type Settled = ReturnType<typeof settle>[number];
interface Result {
  text: string;
  ok: boolean;
  problems: string[];
  ms: number;
  raw: unknown;
  items: Settled[];
}

const local = (iso: string | null) => (iso ? toInputValue(iso, S.timeZone).replace('T', ' ') : null);

function compare(expected: ExpectedItem, got: Settled | undefined, n: number): string[] {
  if (!got) return [`item ${n}: missing`];
  const p: string[] = [];
  const say = (what: string, want: unknown, have: unknown) => p.push(`item ${n} ${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(have)}`);
  if (got.list !== expected.list) say('list', expected.list, got.list);
  if (expected.title !== undefined && !got.title.toLowerCase().includes(expected.title)) say('title', `…${expected.title}…`, got.title);
  if (expected.remindAt !== undefined && local(got.remindAt) !== expected.remindAt) say('remindAt', expected.remindAt, local(got.remindAt));
  const due = got.dueAt ? dueDate(got.dueAt, S.timeZone) : null;
  if (expected.dueAt !== undefined && due !== expected.dueAt) say('dueAt', expected.dueAt, due);
  if (expected.onDate !== undefined && due !== expected.onDate && local(got.remindAt)?.slice(0, 10) !== expected.onDate) {
    say('date', expected.onDate, { remindAt: local(got.remindAt), dueAt: due });
  }
  if (expected.canonical && !expected.canonical.includes(got.grocery?.canonicalName ?? '')) say('canonicalName', expected.canonical, got.grocery?.canonicalName);
  if (expected.section && !expected.section.includes(got.grocery?.section ?? '')) say('section', expected.section, got.grocery?.section);
  if (expected.quantity !== undefined && (got.grocery?.quantity ?? null) !== expected.quantity) say('quantity', expected.quantity, got.grocery?.quantity ?? null);
  if (expected.unsorted !== undefined && got.unsorted !== expected.unsorted) say('unsorted', expected.unsorted, got.unsorted);
  return p;
}

async function run(c: EvalCase, sorter: ReturnType<typeof createSorter>): Promise<Result> {
  const capturedAt = new Date(CAPTURED_AT);
  const { list: fixedList, rest } = splitPrefix(c.text, S.prefixes);
  const deviceRemindAt = parseCapture(c.text, capturedAt, S.prefixes).remindAt;
  const started = Date.now();
  try {
    const { output: raw } = await sorter({ text: rest, capturedAt, settings: S, fixedList, deviceRemindAt }, 30_000);
    const items = settle(parseSortOutput(raw, S), fixedList, deviceRemindAt, S);
    const problems = c.expect.flatMap((e, i) => compare(e, items[i], i + 1));
    if (items.length !== c.expect.length) problems.unshift(`expected ${c.expect.length} items, got ${items.length}: ${items.map((i) => i.title).join(' | ')}`);
    return { text: c.text, ok: problems.length === 0, problems, ms: Date.now() - started, raw, items };
  } catch (err) {
    return { text: c.text, ok: false, problems: [`error: ${err instanceof Error ? err.message : String(err)}`], ms: Date.now() - started, raw: null, items: [] };
  }
}

it('sorting eval set against the real model', { timeout: 600_000 }, async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const sorter = createSorter({ ANTHROPIC_API_KEY: key } as never);

  const results: Result[] = [];
  for (let i = 0; i < CASES.length; i += PARALLEL) {
    results.push(...(await Promise.all(CASES.slice(i, i + PARALLEL).map((c) => run(c, sorter)))));
  }

  // One line per case in the log: the raw answers are how test fixtures get recorded.
  for (const r of results) if (r.raw) console.log(`RAW ${JSON.stringify({ text: r.text, output: r.raw })}`);

  const passed = results.filter((r) => r.ok).length;
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const lines = [
    `## Sorting eval: ${passed} of ${results.length} correct`,
    '',
    `Response time: median ${times[Math.floor(times.length / 2)]} ms, slowest ${times[times.length - 1]} ms.`,
    '',
    ...results.filter((r) => !r.ok).flatMap((r) => [`**${r.text}**`, ...r.problems.map((p) => `- ${p}`), '']),
  ];
  const report = lines.join('\n');
  console.log(report);
  mkdirSync('evals/out', { recursive: true });
  writeFileSync('evals/out/results.json', JSON.stringify(results, null, 2));
  writeFileSync('evals/out/report.md', report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');

  expect(passed / results.length, 'pass rate').toBeGreaterThanOrEqual(PASS_RATE_NEEDED);
});
