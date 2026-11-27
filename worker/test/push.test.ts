// Proves the push request is one a browser can actually read: we play the push
// service and the browser, and decrypt the body ourselves following RFC 8291.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PushPayload } from '../../shared/src/notify';
import type { Env } from '../src/env';
import { createSender } from '../src/push';

const b64 = (x: Uint8Array) => Buffer.from(x).toString('base64url');

/** VAPID keys in the same format as the ones stored in GitHub secrets. */
function vapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = b64(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]));
  return { jwk, publicKey, privateKey: jwk.d! };
}

function decrypt(body: Buffer, browser: crypto.ECDH, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const keyLength = body[20]!;
  const serverKey = body.subarray(21, 21 + keyLength);
  const cipher = body.subarray(21 + keyLength);
  const hkdf = (s: Buffer, ikm: Buffer, info: Buffer, len: number) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, len));
  const ikm = hkdf(auth, browser.computeSecret(serverKey), Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), serverKey]), 32);
  const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', key, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  // The record ends with a 0x02 delimiter (and optional zero padding).
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  return plain.subarray(0, end - 1).toString('utf8');
}

const payload: PushPayload = {
  kind: 'reminder',
  title: 'oven uit ⏰',
  body: '⏰ 14:13 · Personal',
  tag: 'item-1',
  itemId: '1',
  actions: [{ action: 'done', title: 'Done' }],
};

describe('web push request', () => {
  const vapid = vapidKeys();
  const browser = crypto.createECDH('prime256v1');
  browser.generateKeys();
  const auth = crypto.randomBytes(16);
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: b64(browser.getPublicKey()), auth: b64(auth) };
  const env = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'https://example.com/' } as Env;

  async function capture(status = 201) {
    let seen: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(status === 201 ? null : 'nope', { status });
    }) as unknown as typeof fetch;
    const result = await createSender(env, fakeFetch)(subscription, payload, 3600);
    return { result, seen: seen! };
  }

  it('is encrypted so that only the subscribed browser can read it', async () => {
    const { result, seen } = await capture();
    expect(result).toMatchObject({ ok: true, status: 201 });
    expect(seen.url).toBe(subscription.endpoint);
    expect(JSON.parse(decrypt(Buffer.from(seen.init.body as Uint8Array), browser, auth))).toEqual(payload);
  });

  it('asks for immediate delivery and a bounded lifetime', async () => {
    const headers = (await capture()).seen.init.headers as Record<string, string>;
    expect(headers.urgency).toBe('high');
    expect(headers.ttl).toBe('3600');
    expect(headers['content-encoding']).toBe('aes128gcm');
  });

  it('is signed with our VAPID key for the right push service', async () => {
    const headers = (await capture()).seen.init.headers as Record<string, string>;
    const m = /^vapid t=([^,]+),\s*k=(.+)$/.exec(headers.authorization!)!;
    expect(m[2]).toBe(vapid.publicKey);
    const [h, p, s] = m[1]!.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('https://example.com/');
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: vapid.jwk.x, y: vapid.jwk.y }, format: 'jwk' });
    expect(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('reports a subscription that no longer exists', async () => {
    expect((await capture(410)).result).toMatchObject({ ok: false, status: 410, gone: true });
    expect((await capture(500)).result).toMatchObject({ ok: false, status: 500, gone: false });
  });

  it('reports a network failure instead of throwing', async () => {
    const boom = (async () => {
      throw new Error('connection reset');
    }) as unknown as typeof fetch;
    expect(await createSender(env, boom)(subscription, payload, 60)).toMatchObject({ ok: false, status: 0, error: 'connection reset' });
  });
});
