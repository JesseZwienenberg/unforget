# Decisions

One line each: the decision, then why. Newest at the bottom of each milestone.

## M0

- Commit with `git push` from Claude's workspace instead of the connector's file API: the session can push directly, which keeps the spec byte-for-byte verbatim, allows binary files (icons) and makes each commit atomic.
- One repo with npm workspaces (`app/`, `worker/`) and a single lockfile: one `npm ci`, one set of lint/test config.
- Hand-written service worker plus a ~60-line precache step (`app/build/precache.ts`) instead of Workbox or vite-plugin-pwa: fewer dependencies, and M2 needs full control of the worker for notification buttons anyway.
- Service worker is built by Vite as a second entry and registered as a module worker: lets it share typed code with the app later (Done/Snooze from a notification). Chrome supports this; a browser that doesn't simply runs the app without offline support.
- New app versions activate immediately (`skipWaiting` + `clients.claim`) and show on the next open: single user, no reason for an "update available" prompt.
- Cache lookups ignore `Vary` and the query string: found in testing that a `Vary: Origin` response made the cached script miss and broke offline start.
- All cache names start with `unforget-`, and the worker only deletes caches with that prefix: the origin is shared with another app.
- Manifest `start_url`/`scope` are the explicit `/unforget/` path and there is no manifest `id` (it defaults to `start_url`): keeps the app's identity distinct from the other app on this origin.
- The D1 database is found or created by the deploy workflow through the Cloudflare API, and its id is written into `wrangler.jsonc` only in the CI checkout: removes a manual dashboard step and keeps the config free of account-specific ids.
- GitHub Actions secrets are the single place secrets are entered; each deploy copies the Worker's secrets with `wrangler secret bulk`, skipping empty ones: one place to paste, and rotating a token is "change the secret, re-run Deploy".
- All generated secrets (app token and VAPID keys) are created in M0 even though VAPID is used from M2: one visit to GitHub settings instead of two.
- `/health` is public and reports only non-secret facts (version, database ok, whether a token is configured); every other path, including unknown ones, returns 401 without the token.
- The token is compared by hashing both sides and XOR-ing: constant-time without relying on a Workers-only API, so the same code runs in tests.
- Plain `fetch` handler, no router library: three endpoints don't need one.
- CORS origins are a comma-separated `ALLOWED_ORIGINS` variable in `wrangler.jsonc`: a native app origin can be added later without code changes.
- Worker tests run in plain Node Vitest with a fake `env` instead of the Workers Vitest pool: fewer moving parts for now. Revisit in M1 when sync logic needs real SQLite behaviour.
- M0 migration creates only a `meta` table: proves migrations run without committing to the real schema before M1 designs it.
- An end-to-end check (`app/test/e2e-offline.mjs`, playwright-core driving the runner's Chrome) runs in CI: "opens offline" is exactly the kind of thing that breaks silently, and it caught a real bug on day one.
- CI fails if frontend JavaScript exceeds 80 KB gzipped: the budget from the spec, enforced from the start rather than measured at the end.
- Deploy is one workflow with independent app and Worker jobs: the app can go live before Cloudflare is set up, and a Worker failure never blocks a frontend fix.
- GitHub Actions pinned to the Node 24 majors (checkout/setup-node v6, pages actions v5): GitHub removed Node 20 from runners in September 2026.
- TypeScript 6.x rather than 7: it is what the lint tooling currently supports.
- D1 location hint `weur` (Western Europe): closest to the only user.

## M1

- Shared code (types, device parser, time helpers, merge, validation) lives in `shared/` and is imported by both the app and the Worker: one definition of the data and one parser, so the two can't drift.
- All timestamps are UTC ISO strings in `toISOString()` format: they sort correctly as text (SQLite and IndexedDB) and are readable in the export.
- Reminder times from the device parser are rounded to the nearest minute: the cron runs once a minute, so the time shown in the toast is the time the reminder actually fires.
- The device parser handles minutes and hours only ("in 10 min", "over een kwartier", "anderhalf uur"); days, weeks, dates and vague times are left to the LLM: those need the vague-time settings, and guessing wrong on the device is worse than waiting a second.
- "in" and "over" are both accepted in either language: Dutch speakers say "in 10 minuten" too.
- Number words need a space before the unit ("een uur"), digits don't ("10m"): avoids false matches such as "in nu".
- Captures without a prefix go to Personal as a provisional item until the LLM (M3) sorts them.
- Sync cursor is a server-side counter (`rev`), not a timestamp: device clocks differ, and a counter raised inside the same transaction as the write can't skip rows when the phone, laptop and cron overlap.
- Every written row gets its own `rev`: makes paging large histories exact (a new device pulls 500 rows per table per request).
- Last-write-wins is decided in SQL (`ON CONFLICT … WHERE excluded.updated_at > …`) in one D1 batch: atomic, and no read-then-write race.
- A device's rows are sent to SQL as one JSON parameter and unpacked with `json_each`: one statement per table whatever the row count, so the free plan's per-request query limit and SQLite's parameter limit never matter.
- `notifiedAt` and a capture's `sortStatus` are server-owned: the server ignores what devices send for them. `notifiedAt` survives edits and is cleared only when `remindAt` changes (a snooze), so an edit can never cause a second notification.
- A capture's text, time and source are never updated after the first write: the raw capture is kept forever, exactly as typed.
- A device timestamp more than 5 minutes in the future is pulled back to server time: one wrong phone clock must not win every later conflict.
- The outbox is a `dirty` flag on each local row (indexed) rather than a separate table: same behaviour, one less thing to keep consistent.
- The app keeps open and done items in memory and reloads them from IndexedDB after a sync that brought changes: a single user's data is small, and it keeps every screen instant.
- Input validation is hand-written (`shared/src/validate.ts`), no schema library: a handful of shapes, and it keeps the Worker and the app bundle small.
- Worker tests run the real SQL on Node's built-in SQLite behind a small D1 stand-in (`worker/test/d1.ts`): real upsert and JSON behaviour without the heavier Workers test pool.
- An end-to-end test (`app/test/e2e-capture.mjs`) runs real Chrome against `wrangler dev` with a local D1: offline capture on one device, sync, a second device sees it; plus toast fix, undo, share target and export.
- Tabs sit directly above the capture box, not at the top: one-handed reach, and the box stays docked on every tab so capture works from anywhere.
- Marking done is a tap on the circle; swipe-to-done is not built: the spec allows either, a tap can't be triggered by accident while scrolling. Revisit in M5 if it feels slow.
- Marking done shows a short "Done · Undo" toast: the circle is a large target, so a mis-tap needs a way back.
- Edit and More are native `<dialog>` sheets: the Android back gesture closes them and focus returns to the capture box.
- Tapping the send button or a tab never takes focus from the box (pointerdown is cancelled): the keyboard stays up between captures.
- A hand-edited item stops being provisional: the LLM (M3) must not overwrite a manual fix.
- The edit sheet also offers a deadline (date) and Delete: needed to "fix" an item, and both already exist in the data model.
- Share target uses GET with parameters `share_title`, `share_text`, `share_url`; the app saves the capture and removes them from the address so a reload never repeats it.
- The setup link is accepted only for an `https` API address (plain `http` only for localhost): a mistyped link must not send the token in the clear.
- A new app version is announced as "Update ready" in the status corner with a Reload button, instead of reloading automatically: a surprise reload would close the keyboard mid-capture.
- Export reads the local database (which holds everything after a sync) and includes done, archived and deleted rows.
- Settings already sync as one last-write-wins document with all defaults from the spec; the screen to edit them comes in M4.
- Frontend is about 62 KB gzipped, most of it Dexie (required by the spec) and Svelte; the 80 KB CI gate stays.

## Later

Nothing yet.
