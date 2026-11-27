-- M3: LLM sorting. Bookkeeping for retries, and a daily call counter.
ALTER TABLE captures ADD COLUMN sort_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE captures ADD COLUMN sort_next_at TEXT;      -- do not try again before this time
ALTER TABLE captures ADD COLUMN sort_error TEXT;        -- last failure, for diagnosis

-- Captures still waiting for the sorter.
CREATE INDEX captures_unsorted ON captures (sort_next_at)
  WHERE sort_status IN ('pending', 'sorting') AND deleted_at IS NULL;

CREATE TABLE llm_usage (
  day   TEXT PRIMARY KEY,   -- local date, YYYY-MM-DD
  calls INTEGER NOT NULL
);

UPDATE meta SET value = 'm3' WHERE key = 'schema';
