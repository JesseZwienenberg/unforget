// One sync: push the outbox, pull everything changed since the cursor, repeat
// until both sides are drained. Knows nothing about the UI.
import { MAX_SYNC_ROWS, type SyncRequest, type SyncResponse } from '$shared/types';
import type { Config, Storage } from './storage/types';

export class UnauthorizedError extends Error {}
export class OfflineError extends Error {}

const TIMEOUT_MS = 15_000;
const MAX_ROUNDS = 100;

export interface SyncResult {
  /** True when the server sent rows, so the screen should reload its data. */
  received: boolean;
}

async function post(config: Config, body: SyncRequest, fetchFn: typeof fetch): Promise<SyncResponse> {
  let res: Response;
  try {
    res = await fetchFn(`${config.api}/v1/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // fetch only rejects when the request never completed: no network, DNS, timeout.
    throw new OfflineError(String(err));
  }
  if (res.status === 401) throw new UnauthorizedError('token rejected');
  if (!res.ok) throw new Error(`sync failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as SyncResponse;
}

export async function runSync(storage: Storage, config: Config, fetchFn: typeof fetch = fetch): Promise<SyncResult> {
  let received = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const sent = await storage.outbox(MAX_SYNC_ROWS);
    const since = await storage.cursor();
    const response = await post(config, { since, ...sent }, fetchFn);
    await storage.applySync(sent, response);
    if (response.captures.length || response.items.length || response.settings) received = true;
    const fullBatch = sent.captures.length === MAX_SYNC_ROWS || sent.items.length === MAX_SYNC_ROWS;
    if (!response.more && !fullBatch) break;
  }
  return { received };
}
