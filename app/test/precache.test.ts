import { describe, expect, it } from 'vitest';
import { buildPrecache, injectPrecache, type BuiltFile } from '../build/precache';

const file = (path: string, text: string): BuiltFile => ({ path, content: new TextEncoder().encode(text) });

const files = [
  file('index.html', '<html>'),
  file('assets/main-abc.js', 'console.log(1)'),
  file('assets/main-abc.js.map', '{}'),
  file('manifest.webmanifest', '{}'),
  file('sw.js', 'self'),
  file('.nojekyll', ''),
];

describe('buildPrecache', () => {
  it('lists the app shell and leaves out the worker itself, maps and dotfiles', () => {
    expect(buildPrecache(files).urls).toEqual(['assets/main-abc.js', './', 'manifest.webmanifest']);
  });

  it('gives the same version regardless of file order', () => {
    expect(buildPrecache([...files].reverse()).version).toBe(buildPrecache(files).version);
  });

  it('changes the version when any precached file changes', () => {
    const changed = files.map((f) => (f.path === 'index.html' ? file('index.html', '<html lang>') : f));
    expect(buildPrecache(changed).version).not.toBe(buildPrecache(files).version);
  });

  it('ignores changes to files that are not precached', () => {
    const changed = files.map((f) => (f.path === 'sw.js' ? file('sw.js', 'other') : f));
    expect(buildPrecache(changed).version).toBe(buildPrecache(files).version);
  });
});

describe('injectPrecache', () => {
  it('fills in both placeholders', () => {
    const out = injectPrecache('const a=__UF_PRECACHE__,v=__UF_VERSION__;', { version: 'v1', urls: ['./'] });
    expect(out).toBe('const a=["./"],v="v1";');
  });

  it('fails loudly when the build dropped a placeholder', () => {
    expect(() => injectPrecache('const a=1;', { version: 'v1', urls: [] })).toThrow(/__UF_PRECACHE__/);
  });
});
