// A D1 stand-in for tests, backed by Node's built-in SQLite, so the real SQL
// (upserts, json_each, partial indexes) runs for real. Applies the real migrations.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: SQLInputValue[]): Statement {
    return new Statement(this.db, this.sql, params);
  }

  allSync(): { results: unknown[]; success: true; meta: object } {
    return { results: this.db.prepare(this.sql).all(...this.params), success: true, meta: {} };
  }

  async all(): Promise<{ results: unknown[]; success: true; meta: object }> {
    return this.allSync();
  }

  async run(): Promise<{ results: unknown[]; success: true; meta: object }> {
    return this.allSync();
  }

  async first<T>(): Promise<T | null> {
    return (this.allSync().results[0] as T | undefined) ?? null;
  }
}

export interface TestD1 {
  d1: D1Database;
  raw: DatabaseSync;
}

export function createTestD1(): TestD1 {
  const raw = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  const d1 = {
    prepare: (sql: string) => new Statement(raw, sql),
    async batch(statements: Statement[]) {
      raw.exec('BEGIN');
      try {
        const out = statements.map((s) => s.allSync());
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return { d1: d1 as unknown as D1Database, raw };
}
