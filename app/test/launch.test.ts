import { describe, expect, it } from 'vitest';
import { cleanUrl, parseSetupLink, parseShare } from '../src/lib/launch';

describe('setup link', () => {
  it('reads the token and the API address', () => {
    expect(parseSetupLink('#setup=abc123&api=https://unforget.example.workers.dev')).toEqual({
      token: 'abc123',
      api: 'https://unforget.example.workers.dev',
    });
  });

  it('accepts an encoded address and drops a trailing slash', () => {
    expect(parseSetupLink('#setup=t&api=https%3A%2F%2Fw.example.dev%2F')?.api).toBe('https://w.example.dev');
  });

  it('keeps tokens with base64url characters intact', () => {
    expect(parseSetupLink('#setup=FCU-Mq_z77&api=https://w.example.dev')?.token).toBe('FCU-Mq_z77');
  });

  it.each(['', '#', '#setup=abc', '#api=https://w.example.dev', '#setup=abc&api=notaurl', '#setup=abc&api=http://w.example.dev', '#setup=abc&api=javascript:alert(1)'])(
    'ignores "%s"',
    (hash) => {
      expect(parseSetupLink(hash)).toBeNull();
    },
  );

  it('allows plain http only for local development', () => {
    expect(parseSetupLink('#setup=t&api=http://localhost:8787')?.api).toBe('http://localhost:8787');
  });
});

describe('shared text', () => {
  const q = (o: Record<string, string>) => '?' + new URLSearchParams(o).toString();

  it('takes plain shared text', () => {
    expect(parseShare(q({ share_text: 'melk kopen' }))).toBe('melk kopen');
  });
  it('joins a title and a link', () => {
    expect(parseShare(q({ share_title: 'Good article', share_url: 'https://example.com/a' }))).toBe('Good article https://example.com/a');
  });
  it('does not repeat a link that is already in the text', () => {
    expect(parseShare(q({ share_title: 'Good article', share_text: 'Good article https://example.com/a', share_url: 'https://example.com/a' }))).toBe(
      'Good article https://example.com/a',
    );
  });
  it('does not repeat identical parts', () => {
    expect(parseShare(q({ share_title: 'same', share_text: 'same' }))).toBe('same');
  });
  it('is null when nothing was shared', () => {
    expect(parseShare('')).toBeNull();
    expect(parseShare('?other=1')).toBeNull();
    expect(parseShare(q({ share_text: '   ' }))).toBeNull();
  });
});

describe('cleanUrl', () => {
  it('removes the setup fragment so the token does not stay in the address bar', () => {
    expect(cleanUrl('https://x.github.io/unforget/#setup=secret&api=https://w.example.dev')).toBe('/unforget/');
  });
  it('removes share parameters but keeps anything else', () => {
    expect(cleanUrl('https://x.github.io/unforget/?share_text=hi&keep=1#other')).toBe('/unforget/?keep=1#other');
  });
});
