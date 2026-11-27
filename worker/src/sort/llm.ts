import type { TokenUsage } from '../../../shared/src/cost';
import type { Env } from '../env';
import { buildRequest, TOOL_NAME, type PromptInput } from './prompt';
import { extractToolInput } from './output';

export interface SorterAnswer {
  /** The raw tool input, not yet validated. */
  output: unknown;
  /** Tokens the call used, as reported by the API. */
  tokens: Omit<TokenUsage, 'calls'>;
}

/** Sends one capture to the model. Throws on any failure. */
export type Sorter = (input: PromptInput, timeoutMs: number) => Promise<SorterAnswer>;

function tokens(response: unknown): SorterAnswer['tokens'] {
  const u = ((response as { usage?: Record<string, unknown> })?.usage ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  return {
    inputTokens: n(u.input_tokens),
    outputTokens: n(u.output_tokens),
    cacheWriteTokens: n(u.cache_creation_input_tokens),
    cacheReadTokens: n(u.cache_read_input_tokens),
  };
}

export function createSorter(env: Env, fetchFn: typeof fetch = fetch): Sorter {
  return async (input, timeoutMs) => {
    const res = await fetchFn(`${env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildRequest(input)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body: unknown = await res.json();
    return { output: extractToolInput(body, TOOL_NAME), tokens: tokens(body) };
  };
}
