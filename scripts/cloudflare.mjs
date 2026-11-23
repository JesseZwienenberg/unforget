// Small helpers for the Cloudflare REST API, used only by the deploy workflow.

export const PLACEHOLDER_DB_ID = '00000000-0000-0000-0000-000000000000';

/** Puts the real D1 database id into the text of wrangler.jsonc. */
export function replaceDatabaseId(config, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`not a database id: ${id}`);
  if (!config.includes(PLACEHOLDER_DB_ID)) throw new Error('wrangler.jsonc has no placeholder database_id');
  return config.replaceAll(PLACEHOLDER_DB_ID, id);
}

export function workerUrl(workerName, subdomain) {
  return `https://${workerName}.${subdomain}.workers.dev`;
}

/** Keeps only the secrets that actually have a value, so an unset one never wipes a real one. */
export function pickSecrets(env, names) {
  const out = {};
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) out[name] = value;
  }
  return out;
}

export async function cf(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    const detail = data?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || res.statusText;
    throw new Error(`Cloudflare API ${method} ${path} failed (${res.status}): ${detail}`);
  }
  return data.result;
}
