-- M2: one row per browser that should receive notifications.
CREATE TABLE push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  label       TEXT,                 -- e.g. "Android" / "Windows", for the app's device list
  created_at  TEXT NOT NULL,
  seen_at     TEXT NOT NULL,        -- last time the app confirmed this subscription
  last_ok_at  TEXT,                 -- last successful push
  last_error  TEXT                  -- last failure, for diagnosis
);

UPDATE meta SET value = 'm2' WHERE key = 'schema';
