import { describe, expect, it } from 'vitest';
import { safeEqual } from '../src/auth';
import type { Env } from '../src/env';
import worker from '../src/index';

const ORIGIN = 'https://jessezwienenberg.github.io';

function fakeDb(schema: string | null, fail = false): D1Database {
  return {
    prepare: () => ({
      first: async () => {
        if (fail) throw new Error('no such table: meta');
        return schema ? { value: schema } : null;
      },
    }),
  } as unknown as D1Database;
}

function env(overrides: Partial<Env> = {}): Env {
  return { DB: fakeDb('m3'), ALLOWED_ORIGINS: ORIGIN, APP_TOKEN: 'secret-token', VERSION: 'abc123', ...overrides };
}

function call(path: string, init: RequestInit = {}, e: Env = env()): Promise<Response> {
  return worker.fetch(new Request(`https://unforget.example.workers.dev${path}`, init), e);
}

describe('health', () => {
  it('is public and reports the database and version', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: 'unforget', version: 'abc123', db: 'ok', schema: 'm3', tokenConfigured: true });
  });

  it('reports a broken database without crashing', async () => {
    const res = await call('/health', {}, env({ DB: fakeDb(null, true) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, db: 'error' });
  });

  it('never exposes the token', async () => {
    const text = await (await call('/health')).text();
    expect(text).not.toContain('secret-token');
  });
});

describe('auth', () => {
  it('rejects requests without a token', async () => {
    expect((await call('/v1/ping')).status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    expect((await call('/v1/ping', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('accepts the right token', async () => {
    const res = await call('/v1/ping', { headers: { authorization: 'Bearer secret-token' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects everything when no token is configured', async () => {
    const res = await call('/v1/ping', { headers: { authorization: 'Bearer ' } }, env({ APP_TOKEN: undefined }));
    expect(res.status).toBe(401);
    const res2 = await call('/v1/ping', { headers: { authorization: 'Bearer undefined' } }, env({ APP_TOKEN: undefined }));
    expect(res2.status).toBe(401);
  });

  it('hides unknown routes behind auth', async () => {
    expect((await call('/nope')).status).toBe(401);
    expect((await call('/nope', { headers: { authorization: 'Bearer secret-token' } })).status).toBe(404);
  });

  it('safeEqual compares strings of any length', async () => {
    expect(await safeEqual('a', 'a')).toBe(true);
    expect(await safeEqual('a', 'ab')).toBe(false);
    expect(await safeEqual('', '')).toBe(true);
  });
});

describe('cors', () => {
  it('allows the configured origin', async () => {
    const res = await call('/health', { headers: { origin: ORIGIN } });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('does not allow other origins', async () => {
    const res = await call('/health', { headers: { origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers preflight without a token', async () => {
    const res = await call('/v1/ping', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'GET' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('supports several origins', async () => {
    const e = env({ ALLOWED_ORIGINS: `${ORIGIN}, capacitor://localhost` });
    const res = await call('/health', { headers: { origin: 'capacitor://localhost' } }, e);
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
  });
});
