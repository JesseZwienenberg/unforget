import { applyAction } from './actions';
import { isAuthorized } from './auth';
import type { Env } from './env';
import { corsHeaders, json, withHeaders } from './http';
import { createSender, deleteSubscription, listSubscriptions, pushConfigured, saveSubscription, sendToAll } from './push';
import { deliverDueReminders } from './reminders';
import { loadSettings } from './settings';
import { sortCapture, sortPending, type SortDeps } from './sort/apply';
import { createSorter } from './sort/llm';
import { sync } from './sync';
import { usageReport } from './usage';
import { testPayload } from '../../shared/src/notify';
import { parseSyncRequest } from '../../shared/src/validate';

const MAX_BODY_BYTES = 2_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = Record<string, unknown>;

async function readJson(request: Request): Promise<Body | Response> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413);
  try {
    const body: unknown = text ? JSON.parse(text) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid body' }, 400);
    return body as Body;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
}

async function health(env: Env): Promise<Response> {
  let schema: string | null = null;
  try {
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'schema'").first<{ value: string }>();
    schema = row?.value ?? null;
  } catch (err) {
    console.error('health: database check failed', err);
  }
  const db = schema ? 'ok' : 'error';
  return json({
    ok: db === 'ok',
    service: 'unforget',
    version: env.VERSION ?? 'dev',
    time: new Date().toISOString(),
    db,
    schema,
    tokenConfigured: Boolean(env.APP_TOKEN),
    pushConfigured: pushConfigured(env),
    llmConfigured: Boolean(env.ANTHROPIC_API_KEY),
  });
}

/** Total time a sync request may spend waiting for the sorter before answering with provisional items. */
const INLINE_SORT_MS = 3500;
const INLINE_SORT_MAX = 3;
const CRON_SORT_MS = 20_000;
const CRON_SORT_MAX = 3;

async function sortDeps(env: Env, now: Date): Promise<SortDeps | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const settings = await loadSettings(env.DB);
  return settings.llm.enabled ? { db: env.DB, sorter: createSorter(env), settings, now } : null;
}

async function handleSync(request: Request, env: Env, ctx: ExecutionContext | undefined): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const now = new Date();
  const parsed = parseSyncRequest(body, now);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  let response = await sync(env.DB, parsed.value, now);

  // Sort brand-new captures now, so the answer already holds the real items. If the
  // model is slow the request answers with the provisional ones and the cron finishes the job.
  const fresh = parsed.value.captures.filter((c) => !c.deletedAt).slice(0, INLINE_SORT_MAX);
  if (fresh.length) {
    const deps = await sortDeps(env, now);
    if (deps) {
      const outcomes = await Promise.all(
        fresh.map((c) =>
          sortCapture(deps, c.id, INLINE_SORT_MS).catch((err) => {
            console.error('inline sort', err);
            return 'failed' as const;
          }),
        ),
      );
      if (outcomes.includes('sorted')) response = await sync(env.DB, { since: parsed.value.since, captures: [], items: [], settings: null }, now);
    }
  }
  // A reminder that was already due when it arrived (the phone was offline) goes
  // out right away instead of waiting for the next cron minute.
  const stamp = now.toISOString();
  if (ctx && pushConfigured(env) && parsed.value.items.some((i) => i.remindAt && i.remindAt <= stamp && i.status === 'open')) {
    ctx.waitUntil(deliverDueReminders(env.DB, createSender(env), now).catch((err) => console.error('deliver after sync', err)));
  }
  return json(response);
}

function validSubscription(body: Body): { endpoint: string; p256dh: string; auth: string } | null {
  const keys = body.keys as Body | undefined;
  const { endpoint } = body;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const sub = validSubscription(body);
  if (!sub) return json({ error: 'invalid subscription' }, 400);
  const label = typeof body.label === 'string' ? body.label.slice(0, 60) : null;
  await saveSubscription(env.DB, sub, label, new Date());
  return json({ ok: true });
}

async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (typeof body.endpoint !== 'string') return json({ error: 'invalid endpoint' }, 400);
  await deleteSubscription(env.DB, body.endpoint);
  return json({ ok: true });
}

async function handleTestPush(env: Env): Promise<Response> {
  if (!pushConfigured(env)) return json({ error: 'push_not_configured' }, 503);
  const now = new Date();
  const subs = await listSubscriptions(env.DB);
  const results = await sendToAll(env.DB, createSender(env), subs, testPayload(now, await loadSettings(env.DB)), now);
  return json({
    devices: subs.length,
    delivered: results.filter((r) => r.ok).length,
    errors: results.filter((r) => !r.ok).map((r) => r.error ?? 'failed'),
  });
}

async function handleAction(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (typeof body.action !== 'string') return json({ error: 'invalid action' }, 400);
  const result = await applyAction(env.DB, id.toLowerCase(), body.action, new Date(), await loadSettings(env.DB));
  return result.ok ? json({ ok: true, item: result.item }) : json({ error: result.error }, result.status);
}

async function route(request: Request, env: Env, ctx: ExecutionContext | undefined): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (method === 'OPTIONS') return new Response(null, { status: 204 });

  // Public: no secrets, used by the smoke test and uptime checks.
  if (pathname === '/health' && method === 'GET') return health(env);

  // Everything else requires the bearer token.
  if (!(await isAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);

  if (pathname === '/v1/ping' && method === 'GET') return json({ ok: true });
  if (pathname === '/v1/sync' && method === 'POST') return handleSync(request, env, ctx);

  if (pathname === '/v1/usage' && method === 'GET') return json(await usageReport(env.DB, await loadSettings(env.DB), new Date()));

  if (pathname === '/v1/push/key' && method === 'GET') {
    return env.VAPID_PUBLIC_KEY ? json({ publicKey: env.VAPID_PUBLIC_KEY }) : json({ error: 'push_not_configured' }, 503);
  }
  if (pathname === '/v1/push/subscribe' && method === 'POST') return handleSubscribe(request, env);
  if (pathname === '/v1/push/unsubscribe' && method === 'POST') return handleUnsubscribe(request, env);
  if (pathname === '/v1/push/test' && method === 'POST') return handleTestPush(env);

  const action = /^\/v1\/items\/([^/]+)\/action$/.exec(pathname);
  if (action?.[1] && method === 'POST') {
    return UUID.test(action[1]) ? handleAction(request, env, action[1]) : json({ error: 'not_found' }, 404);
  }

  return json({ error: 'not_found' }, 404);
}

/** Everything that runs on the per-minute cron. */
export async function runCron(env: Env, now: Date): Promise<void> {
  // Reminders first: they are time-critical, sorting is not.
  if (pushConfigured(env)) {
    const report = await deliverDueReminders(env.DB, createSender(env), now);
    if (report.due) console.log('reminders', JSON.stringify(report));
  }
  const deps = await sortDeps(env, now);
  if (deps) {
    const tally = await sortPending(deps, CRON_SORT_MAX, CRON_SORT_MS);
    if (tally.sorted || tally.failed || tally.capped) console.log('sorting', JSON.stringify(tally));
  }
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env, ctx);
    } catch (err) {
      console.error('unhandled', err);
      response = json({ error: 'internal' }, 500);
    }
    return withHeaders(response, corsHeaders(request, env));
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
