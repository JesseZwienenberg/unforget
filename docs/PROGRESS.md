# Progress

## Done

- **M0 – Bootstrap** (accepted 26 Nov 2026): repo, CI, deploys, installable offline placeholder, Worker health endpoint. Phone test passed.

## In progress

**M1 – Capture**: built and deployed; waiting for Jesse's phone test.

What exists:
- `shared/`: types, settings defaults, device parser (prefixes + relative times, NL/EN), time-zone helpers, last-write-wins merge, sync validation.
- Worker: `POST /v1/sync` (LWW upserts in SQL, `rev` cursor, paging), migration `0002_sync.sql` (captures, items, settings, sync_state).
- App: capture box docked at the bottom, tabs (Today / Work / Personal / Groceries), toast with tap-to-fix and Undo, edit sheet, IndexedDB via Dexie behind `Storage`, outbox + sync, setup link, share target, export, sync status + More sheet.
- Tests: 178 unit tests; two Chrome end-to-end tests (offline shell; full capture → sync → second device flow against a local Worker).

Live addresses:
- App: https://jessezwienenberg.github.io/unforget/
- Worker: https://unforget.jessez1997.workers.dev

## Exact next step

1. Jesse runs the M1 phone test (setup link, offline capture, laptop, share, export) and reports back, in particular whether the keyboard opens by itself when the app starts.
2. Fix whatever he reports.
3. On his OK: mark M1 done here and start M2 (reminders). First M2 tasks: pick a Web Push library that runs on Workers (WebCrypto), add `push_subscriptions` migration, subscribe flow in the app, per-minute cron with `notifiedAt`, notification buttons in the service worker.

## Known issues

- Whether Android opens the keyboard automatically on launch is untested (cannot be checked off-device).
- An already-installed app picks up the share target only after Chrome refreshes the install (up to a day) or after reinstalling.
- No "not scheduled yet: offline" warning yet: it arrives with reminders in M2. Reminder times are stored and shown, but nothing notifies until M2.
