import type { Env } from './env';

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Compares two strings without leaking where they differ (hash first, then constant-time XOR). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= (ha[i] ?? 0) ^ (hb[i] ?? 0);
  return diff === 0;
}

/** True when the request carries the app token as a bearer header. */
export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const expected = env.APP_TOKEN;
  if (!expected) return false; // no token configured: nothing is allowed
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1]) return false;
  return safeEqual(match[1], expected);
}
