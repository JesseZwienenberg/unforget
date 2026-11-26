-- M1: captures, items and settings, synced with the app.
-- Every synced row carries `rev`: a number from one global counter, raised on
-- every accepted write. A device asks for "everything with rev above my cursor".

CREATE TABLE sync_state (
  id  INTEGER PRIMARY KEY CHECK (id = 1),
  seq INTEGER NOT NULL
);
INSERT INTO sync_state (id, seq) VALUES (1, 0);

CREATE TABLE captures (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,              -- raw text, kept forever
  captured_at TEXT NOT NULL,
  source      TEXT NOT NULL,
  sort_status TEXT NOT NULL DEFAULT 'pending',  -- server-owned
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  rev         INTEGER NOT NULL
);
CREATE INDEX captures_rev ON captures (rev);

CREATE TABLE items (
  id                TEXT PRIMARY KEY,
  capture_id        TEXT,
  list              TEXT NOT NULL,
  title             TEXT NOT NULL,
  remind_at         TEXT,
  due_at            TEXT,
  notified_at       TEXT,                 -- server-owned
  status            TEXT NOT NULL,
  touched_at        TEXT NOT NULL,
  grocery_canonical TEXT,
  grocery_display   TEXT,
  grocery_quantity  REAL,
  grocery_section   TEXT,
  unsorted          INTEGER NOT NULL DEFAULT 0,
  provisional       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  rev               INTEGER NOT NULL
);
CREATE INDEX items_rev ON items (rev);
CREATE INDEX items_capture ON items (capture_id);
-- For the reminder cron (M2): open, not yet notified, by time.
CREATE INDEX items_due_reminders ON items (remind_at)
  WHERE remind_at IS NOT NULL AND notified_at IS NULL AND status = 'open' AND deleted_at IS NULL;

CREATE TABLE settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  json       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev        INTEGER NOT NULL
);

UPDATE meta SET value = 'm1' WHERE key = 'schema';
