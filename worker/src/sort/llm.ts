import type { Env } from '../env';
import { buildRequest, TOOL_NAME, type PromptInput } from './prompt';
import { extractToolInput } from './output';

/** Sends one capture to the model and returns the raw tool input. Throws on any failure. */
export type Sorter = (input: PromptInput, timeoutMs: number) => Promise<unknown>;

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
    return extractToolInput(await res.json(), TOOL_NAME);
  };
}
