// What the sorter costs. Prices are Anthropic's list prices for Claude Haiku 5.5
// in US dollars per million tokens (prompts under 100K tokens), as of November 2026.
// If Anthropic changes them, change them here; the stored token counts stay valid.
export const PRICES_USD_PER_MTOK = { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 } as const;

export interface TokenUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export const NO_USAGE: TokenUsage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

export function costUsd(u: TokenUsage): number {
  const p = PRICES_USD_PER_MTOK;
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheWriteTokens * p.cacheWrite + u.cacheReadTokens * p.cacheRead) / 1_000_000;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export interface UsagePeriod extends TokenUsage {
  costUsd: number;
}

/** What GET /v1/usage returns. */
export interface UsageReport {
  today: UsagePeriod;
  /** The current calendar month. */
  month: UsagePeriod;
  allTime: UsagePeriod;
  /** Most recent first, days with at least one call. */
  days: ({ day: string } & UsagePeriod)[];
  dailyCap: number;
  since: string | null;
}

/** "$0.0042" for small amounts, "$1.23" otherwise. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  return amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}
