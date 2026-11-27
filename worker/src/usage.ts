import { addUsage, costUsd, NO_USAGE, type TokenUsage, type UsagePeriod, type UsageReport } from '../../shared/src/cost';
import type { Settings } from '../../shared/src/settings';
import { localDate } from '../../shared/src/time';

interface Row {
  day: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
}

/** Adds the tokens of one model call to today's row (the call itself was counted when it was reserved). */
export async function recordTokens(db: D1Database, settings: Settings, now: Date, used: Omit<TokenUsage, 'calls'>): Promise<void> {
  await db
    .prepare(
      `UPDATE llm_usage SET input_tokens = input_tokens + ?2, output_tokens = output_tokens + ?3,
         cache_write_tokens = cache_write_tokens + ?4, cache_read_tokens = cache_read_tokens + ?5
       WHERE day = ?1`,
    )
    .bind(localDate(now, settings.timeZone), used.inputTokens, used.outputTokens, used.cacheWriteTokens, used.cacheReadTokens)
    .run();
}

const fromRow = (r: Row): TokenUsage => ({
  calls: r.calls,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  cacheWriteTokens: r.cache_write_tokens,
  cacheReadTokens: r.cache_read_tokens,
});
const period = (u: TokenUsage): UsagePeriod => ({ ...u, costUsd: costUsd(u) });

export async function usageReport(db: D1Database, settings: Settings, now: Date): Promise<UsageReport> {
  const { results } = await db.prepare('SELECT * FROM llm_usage ORDER BY day DESC').all<Row>();
  const today = localDate(now, settings.timeZone);
  const month = today.slice(0, 7);
  const sum = (rows: Row[]) => rows.map(fromRow).reduce(addUsage, NO_USAGE);
  return {
    today: period(sum(results.filter((r) => r.day === today))),
    month: period(sum(results.filter((r) => r.day.startsWith(month)))),
    allTime: period(sum(results)),
    days: results.slice(0, 31).map((r) => ({ day: r.day, ...period(fromRow(r)) })),
    dailyCap: settings.llm.dailyCap,
    since: results.length ? results[results.length - 1]!.day : null,
  };
}
