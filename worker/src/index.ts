import { isAuthorized } from './auth';
import type { Env } from './env';
import { corsHeaders, json, withHeaders } from './http';

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
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  // Public: no secrets, used by the smoke test and uptime checks.
  if (url.pathname === '/health' && request.method === 'GET') return health(env);

  // Everything else requires the bearer token.
  if (!(await isAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);

  if (url.pathname === '/v1/ping' && request.method === 'GET') return json({ ok: true });

  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (err) {
      console.error('unhandled', err);
      response = json({ error: 'internal' }, 500);
    }
    return withHeaders(response, corsHeaders(request, env));
  },
} satisfies ExportedHandler<Env>;
