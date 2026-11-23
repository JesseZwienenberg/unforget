import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pickSecrets, PLACEHOLDER_DB_ID, replaceDatabaseId, workerUrl } from './cloudflare.mjs';

describe('deploy helpers', () => {
  it('the committed wrangler.jsonc still has the placeholder the deploy replaces', () => {
    const config = readFileSync(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8');
    const id = '12345678-90ab-cdef-1234-567890abcdef';
    const out = replaceDatabaseId(config, id);
    expect(out).toContain(`"database_id": "${id}"`);
    expect(out).not.toContain(PLACEHOLDER_DB_ID);
  });

  it('refuses a value that is not a database id', () => {
    expect(() => replaceDatabaseId(`"${PLACEHOLDER_DB_ID}"`, 'oops')).toThrow();
  });

  it('builds the workers.dev address', () => {
    expect(workerUrl('unforget', 'jesse')).toBe('https://unforget.jesse.workers.dev');
  });

  it('never uploads empty secrets', () => {
    expect(pickSecrets({ A: 'x', B: '', C: '  ' }, ['A', 'B', 'C', 'D'])).toEqual({ A: 'x' });
  });
});
