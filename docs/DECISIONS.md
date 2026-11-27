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

## M2

- Android/Chrome does not open the keyboard on a cold start without a tap (it does when returning to the running app). Closest alternative, agreed with Jesse: a tap anywhere on empty space focuses the box. A truly automatic keyboard needs the native app (v3).
- Web Push library: `@block65/webcrypto-web-push` (WebCrypto only, one small dependency). A test decrypts its output independently (RFC 8291) and verifies the VAPID signature with our key format, since real delivery can't be tested off-device.
- Push is sent with `Urgency: high` and a TTL of 12 hours: wakes the phone at once; if the phone is off, the push service keeps it half a day, after which a reminder is no longer useful as a notification (it shows as overdue in the app).
- A reminder is claimed before it is sent: `notified_at` is set by an UPDATE guarded with "still not notified, same time, still open", then pushed. Overlapping runs (cron plus a sync-triggered send) can't both win the row, so nothing is sent twice.
- If no device accepts the push, the claim is released and the next minute tries again; `notified_at` only stays set after a real delivery to at least one device. A reminder never disappears silently.
- A reminder counts as late when it goes out more than 90 seconds after its time; the notification then reads "Late · was due …".
- Reminders more than 24 hours overdue are not pushed (they are marked handled and show under Overdue): avoids a burst of stale notifications after a long outage or a first-time subscribe.
- With no subscribed device, fresh reminders are left unclaimed and go out, marked late, as soon as a device turns notifications on.
- A sync that brings in an already-due reminder triggers delivery immediately (`waitUntil`) instead of waiting for the next cron minute.
- At most about 40 pushes per cron run: stays within the free plan's limit on outgoing requests; the rest go out the next minute.
- Notification buttons are action ids `done` and `snooze:<preset>`; presets are `<n>m`, `<n>h`, `tonight`, `tomorrow-morning`, resolved by one shared function on both the server (notification button) and the app (snooze sheet).
- "Tonight" after the evening time has passed means tomorrow evening: a snooze must never land in the past.
- A notification button calls `POST /v1/items/:id/action` from the service worker, which reads the token from IndexedDB directly (no Dexie in the worker). If the call fails, the notification is shown again with the reason: it must not vanish on a failed "Done".
- The server applies button actions with its own clock as `updatedAt`; devices pick the change up on their next sync.
- Tapping the notification body opens the app with the snooze sheet (presets, pick a time, Done); the item id travels as `?item=` and is removed from the address.
- The app re-registers its push subscription on every start when permission is already granted, and replaces a subscription made with a different key: the server's copy stays valid without the user doing anything.
- "Send a test notification" in the More sheet reports how many devices accepted it and the push service's error if not: the main tool for diagnosing delivery on a phone.
- "not scheduled yet: offline" is shown in the toast and on the row while an item with a reminder has not been accepted by the server and the app is offline or failing to sync; not during the split second of a normal sync.
- The cron and VAPID subject are in `wrangler.jsonc`; the smoke test now fails if the VAPID secrets are missing on the Worker.
- The service worker's push handler is tested in real Chrome by delivering a push through DevTools; the encrypted hop through Google's push service can only be tested on the phone.

## M3

- No `temperature` is sent, although the spec says temperature 0: Anthropic's documentation for Claude Haiku 5.5 says to omit sampling parameters for this model. Reported to Jesse.
- Forced tool use (`tool_choice` naming the `file_items` tool) without `strict`: the forced call is the long-established path and returns JSON immediately (a forced call also skips the model's thinking, which keeps it fast). Strict mode's supported schema subset could not be verified from the workspace, and the output is validated by our own code anyway.
- The Anthropic API is called with plain `fetch`, no SDK: one request shape, and it keeps the Worker small.
- The model is told to write local wall-clock times; the offset it writes is ignored and the wall clock is interpreted in the user's time zone (an explicit `Z` is taken as UTC): models get daylight-saving offsets wrong but get "09:00 that day" right.
- The user message contains a 15-day calendar with weekday names: the model reads dates off a list instead of calculating them.
- All times are relative to the capture time, not to when sorting runs: a retry hours later gives the same result.
- The phone's relative-time result is passed to the model and then enforced by code: a single item always keeps the device's exact `remindAt`; with several items, the one within 2 minutes of it is snapped to it.
- A prefix (w/p/g) is stripped before the model sees the text, and the list is enforced by code afterwards, for every item of that capture.
- Confidence below 0.6 → Personal, marked unsorted (never when a prefix fixed the list).
- The first sorted item takes over the provisional item's id; further items get ids derived from the capture id and position (SHA-256), and `createdAt` one millisecond apart: retries write the same rows, and items keep their written order on every device.
- A capture whose provisional item was edited, ticked off or deleted by the user is marked sorted without calling the model: a manual fix is never overwritten.
- When the server replaces the provisional item, its `updatedAt` is set later than the device's copy even if the phone's clock runs ahead: otherwise last-write-wins would keep the provisional one.
- Grocery merge: a new grocery whose canonical name matches an open grocery raises that line's quantity (a missing quantity counts as 1) and no new line is created; the provisional item is soft-deleted. Ticked-off groceries are not merged into: buying it again is a new line.
- Sorting is claimed per capture (`sort_status = 'sorting'` with a 2-minute lease) before the model is called: the sync request and the cron can't both sort it, which matters because a grocery merge is not idempotent.
- Inside the sync request, up to 3 new captures are sorted in parallel with a 3.5-second limit; on timeout or error the response carries the provisional items and the cron retries after 1, 2, 5, 15, 60 and 360 minutes, then marks the capture failed (the provisional item simply stays).
- The daily cap counts calls in `llm_usage` per local date with one atomic statement; at the cap, captures wait (without using up an attempt) and are picked up after midnight.
- Unknown grocery sections from the model fall back to "Other" rather than failing the sort.
- The toast updates when the sorted result arrives ("Saved → 3 items · …"); Undo still removes everything the capture produced, except a quantity that was merged into an existing grocery line.
- "Sort captures automatically" switch lives in the More sheet for now; the full settings screen is M4.
- Two fixture files: `recorded.json` holds real model answers copied from the eval workflow's log (the workspace can't download artifacts), `outputs.json` holds hand-written edge cases that must be tolerated or rejected.
- Dutch clock phrases ("half 4", "kwart voor 6", "kwart over 8") are detected by code and spelled out for the model as hints: the first eval run read "half 4" as 16:30. With the hints the eval set scored 36 of 36 on four consecutive runs (median response about 650 ms).
- The smoke test waits up to a minute for freshly applied Worker secrets before judging: the first deploy with a new secret raced it.
- Evals run through Vitest with their own config (`vitest.eval.config.ts`) so they can import the Worker's real prompt and validation code; they are never part of CI.
- `ANTHROPIC_BASE_URL` exists only so the end-to-end test can point the Worker at a stand-in model.
- Cost: about 2,500 input and 150 output tokens per capture at $0.10 / $0.50 per million tokens is roughly $0.0003 per capture; the 300-per-day cap bounds it at about 10 cents a day.

## Later

Nothing yet.
