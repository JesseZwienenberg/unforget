# Build "Unforget": a personal capture app (v1)

You are building a personal app for me, from scratch. I will not write or run code myself: you write everything, I test on my phone. Work autonomously and stop only where this spec says to.

## 0. How you work in this conversation
- You are in a normal Claude conversation with a GitHub connector and your own Linux workspace (Node, npm). This is not Claude Code.
- Write and test code in your workspace: install dependencies, build, run the tests. Then commit the files to the repo through the GitHub connector (several files per commit). Only commit when the build and tests pass in your workspace.
- Your workspace can reach package registries and GitHub, but probably not Cloudflare or my deployed app. So all deploys and smoke tests run in GitHub Actions. If you can't read the Actions results yourself, ask me to open the Actions tab and tell you what failed.
- Commit straight to `main`; every push deploys. That's fine until v1 is in daily use.
- Keep `docs/PROGRESS.md` up to date: finished milestones, what's in progress, and the exact next step. When this conversation gets long, update it and tell me to start a new conversation with: "Continue building Unforget: read docs/SPEC.md, docs/DECISIONS.md and docs/PROGRESS.md in <owner>/unforget and carry on with the next step." In a new conversation, first read those three files and get the current code into your workspace before changing anything.

### First actions
1. Create a public repository named `unforget` under my GitHub account, with a README. If the name is taken, ask me.
2. Save this entire prompt verbatim as `docs/SPEC.md`. It is the source of truth for this and future conversations.
3. Create `docs/DECISIONS.md` (log every non-obvious choice, one line each: decision + why) and `docs/PROGRESS.md`.
4. Start milestone M0.

## 1. What we're building
A one-box capture app for my Android phone that is faster than texting myself on WhatsApp (which is what I do today). I type anything, in any mix of Dutch and English, press enter, and I'm done. The app splits it into items, files them under Work, Personal or Groceries, and turns any time it finds into a reminder. It never asks me to organize or review: items with a time remind me, items without one quietly fade away, and one morning notification tells me what matters today.

Core requirement: capture must be extremely fast. If writing something down takes more effort than forgetting it, the app has failed. Every decision serves this.

Success test: two weeks after v1, I no longer text myself on WhatsApp.

## 2. Context and constraints
- Single user: me. No accounts, no sharing.
- Phone: Samsung Galaxy S25 Ultra with Chrome. The app is installed from Chrome (not Samsung Internet), because local data and push subscriptions belong to one browser.
- Laptop (Windows/Linux): used rarely, by opening the same URL in a desktop browser.
- Input: mostly typing; voice only via the keyboard's own mic key. Dutch and English, often mixed within one sentence.
- Interface language: English.
- Work items contain titles only, no confidential details. There is no notes field.
- Budget: €0–5/month in total. Expected: €0 hosting and well under €1/month for the LLM.
- Addresses: free ones. Frontend on GitHub Pages at `https://<github-user>.github.io/unforget/`, backend on `*.workers.dev`. The repo is public. I already host another app on GitHub Pages under the same account, so both apps share one origin.
- Time zone: Europe/Amsterdam by default (a setting).

## 3. Architecture (decided; don't change without asking)
- Frontend: TypeScript + Svelte + Vite, built as a static single-page app (no SvelteKit server features, no server rendering). It is served from a subpath on GitHub Pages: set the Vite base path, manifest `scope`/`start_url` and service worker scope to match.
- PWA: web app manifest plus a service worker that precaches the whole app shell, so the app opens without touching the network. My other GitHub Pages app shares this origin, so namespace all local storage (database name, cache names) and keep the service worker scoped to `/unforget/`.
- Local data: IndexedDB via Dexie, behind a small storage interface of our own. Request persistent storage. Everything is saved locally first.
- Backend: one Cloudflare Worker (TypeScript) with D1 (SQLite), on the free plan. It exists only for what GitHub Pages can't do: run code at a set time, keep secrets, store data. Keep it small: a minimal router or a plain fetch handler. It does three jobs:
  1. The `sync` endpoint (section 6).
  2. LLM sorting with Claude Haiku (model id `claude-haiku-5-5`) via the Anthropic API. The API key is a Worker secret and never reaches the browser.
  3. One Cron Trigger that runs every minute: sends due reminders and the morning digest, retries failed LLM sorting, and runs the nightly fading job. Cron runs in UTC, so store all times in UTC and compute Amsterdam local time inside the job; daylight saving must be handled correctly.
- Push: standard Web Push with VAPID. Send with the `Urgency: high` header and a sensible TTL. Use a Web Push library that runs on the Workers runtime (WebCrypto); many popular ones assume Node.
- Auth: one long random token stored as a Worker secret, sent as a bearer header. First-run setup uses a one-time link `<app-url>#setup=<token>&api=<worker-url>`: the app stores both locally and removes the fragment from the URL. CORS on the Worker allows only my GitHub Pages origin (configurable, for a native app later).
- Deploy: GitHub Actions only. On push to `main`: run tests, build and deploy the frontend to GitHub Pages, deploy the Worker with Wrangler and apply D1 migrations, then run a smoke test against the deployed Worker.

## 4. v1 features

### Capture
- Opening the app lands in the text box, docked at the bottom like a chat app (WhatsApp muscle memory). Try to open the keyboard automatically; if Android won't do that without a tap, make the box the obvious one-tap target and tell me.
- Enter saves and clears the box, ready for the next item. No fields, no choices.
- Every save shows a short toast, e.g. "Saved → Groceries · ketchup" or "Saved → Personal · ⏰ 14:13 · oven uit". Tapping the toast lets me fix list/time/title; Undo removes the capture. I won't review later, so this is my only correction moment, and it's optional.
- Share target: sharing text or a link from any Android app saves it as a capture (auto-save, same toast with undo).
- Prefixes override the list and work without the LLM: `w ` = Work, `p ` = Personal, `g ` = Groceries (letters configurable).
- On the device, at capture time, a small deterministic parser handles prefixes and explicit relative times in both languages ("in 10 min", "over 10 minuten", "over een kwartier", "in an hour", "over 2 uur"). It immediately creates a provisional item, so a reminder works even when the LLM is down. The LLM result later replaces the provisional item.
- Relative times are always computed from the moment I typed, not from when the capture was processed. If a reminder time has already passed when it reaches the server, send it immediately, marked as late.
- If a capture with a reminder hasn't reached the server yet, show that clearly ("not scheduled yet: offline"). A reminder must never fail silently.

### Sorting (LLM, server-side, in the background)
- Splits one capture into several items, picks the list, cleans up the title (keep my language, never translate) and extracts times.
- Distinguishes reminders (`remindAt`: notify me at that time) from deadlines (`dueAt`: shown on Today and in the digest, no separate notification).
- Groceries: a canonical name for de-duplication across languages ("melk" = "milk"), a quantity, and a section chosen from my configured section list. Adding a grocery that's already on the list merges it and bumps the quantity instead of duplicating.
- Vague times map to my settings (section 5), never to invented times.
- Low confidence: the item goes to Personal, marked "unsorted".
- The raw capture text is always kept, forever.
- Use tool use with a forced tool (or the API's structured output) so the response is valid JSON, and validate it against a schema anyway. Temperature 0. Give the model the current Amsterdam date and time, the capture time, my settings, the list definitions and about 10 mixed Dutch/English examples.
- Output contract per capture, a list of items, each with:
  - `title` (string)
  - `list`: `work` | `personal` | `groceries`
  - `remindAt`: ISO 8601 datetime with offset, or null
  - `dueAt`: ISO date or datetime, or null
  - `grocery`: null, or `{ canonicalName, displayName, quantity (or null), section }`
  - `confidence`: number from 0 to 1
- Guards: a timeout of a few seconds inside the sync request (if exceeded, return the provisional items and let the cron retry with backoff); a daily cap on LLM calls (default 300) so a leaked token can't run up a bill; an LLM on/off setting.

### Reminders
- Time-based only. The per-minute cron finds due reminders, sends a push to every subscription and records `notifiedAt`, so nothing is ever sent twice.
- Each notification has two configurable action buttons, by default "Done" and "Snooze 1h". These must work from the service worker without opening the app. Tapping the notification body opens a small snooze sheet: +1 hour, tonight, tomorrow morning, pick a time.
- Morning digest: one notification at the configured time (default 08:00, every day, days configurable), sent only when it has content: reminders today, due today, overdue, items fading within 2 days. Tapping it opens Today.

### Self-cleaning (replaces any review)
- Rule: nothing lives forever untouched. Defaults: undated Personal items fade after 14 days, undated Work items after 30, overdue items 7 days after their time. Groceries never fade until ticked off. All configurable.
- Fading means archived, never deleted. Snoozing, editing or re-adding an item resets its clock.
- Runs nightly inside the per-minute cron (e.g. at 03:00 local time).

### Screens
- Home: the input plus "Today" (reminders today, due today, overdue).
- Tabs: Work · Personal · Groceries. Swipe or tap to mark done; tap to edit list/time/title.
- Groceries: grouped by section in my configured order; ticked items move to "Recent" for one-tap re-adding.
- Work: shows deadlines, overdue in red. Nothing more.
- Settings (section 5), synced through the server, with an "Export everything (JSON)" button.
- A small sync/offline status indicator that never blocks typing.
- Minimal design: system font, follows system light/dark mode, large tap targets, one-handed use. Also usable in a laptop browser.

## 5. Settings (all editable in the app; defaults below)
- Time zone: Europe/Amsterdam
- Vague times: morning 07:45, afternoon 13:00, evening/tonight 20:00, "this weekend" Saturday 10:00, "tomorrow" without a time = the morning time. Recognize Dutch and English (ochtend, morgenochtend, middag, vanavond, dit weekend, morgen, etc.).
- Digest: 08:00, every day
- Fading: Personal 14 days, Work 30 days, overdue 7 days, Groceries off
- Notification buttons: Done, Snooze 1h. Snooze presets: +1h, tonight, tomorrow morning.
- Prefixes: `w`, `p`, `g`
- Grocery sections, in order: Fruit & vegetables, Bread & bakery, Dairy & eggs, Cheese & deli, Meat & fish, Frozen, Pantry, Drinks, Snacks, Household, Personal care, Other
- LLM sorting: on. Daily LLM call cap: 300.

## 6. Data and sync
- Client-generated UUIDs for everything; every write is idempotent.
- Tables (refine as needed and log changes in DECISIONS.md): `captures` (raw text, captured-at, source, sorting status), `items` (derived from a capture: list, title, remindAt, dueAt, notifiedAt, status open/done/archived, touchedAt, grocery fields, unsorted flag, createdAt, updatedAt, deletedAt), `push_subscriptions`, `settings` (one row), `llm_usage` (daily counter).
- Sync: the device keeps an outbox and calls `sync` after a capture, on app open, when coming back online and periodically while open. It sends its changes and receives everything changed since its last sync. Last write wins per item (by `updatedAt`); deletes are soft so they sync too. No real-time sync, no conflict screens.
- New captures are sorted by the LLM during `sync` and returned in the same response when possible.
- Because raw captures are kept, items can be regenerated later with a better prompt.

## 7. Keep the door open for a native Android app (v3)
We will probably wrap this in Capacitor later. Don't build that now, but:
1. Keep the frontend a purely static single-page app.
2. Put storage, reminder delivery and capture inputs behind small interfaces (web now: IndexedDB, server push, share target; native later: SQLite, on-device alarms, home-screen widget and quick-settings tile).
3. Store reminders as absolute UTC times; whoever delivers them is a detail.
4. Bearer-token auth and configurable CORS, so a native app can use the same API.
5. `notifiedAt` per reminder, so switching delivery method never sends a reminder twice.

## 8. Not in v1 (don't build these; ask me first)
Custom voice input · location reminders · recurring reminders · sharing, accounts, multiple users · notes, descriptions, attachments · priorities, tags, projects, subtasks · inbox or review screens · stats, streaks, gamification · search · desktop hotkey · widgets or a native app · calendar, email or other integrations · long-press icon shortcuts · learning from my corrections · grocery staples.
If you think one of these is needed, add it to a "Later" section in `docs/DECISIONS.md` instead.

For context, the roadmap after v1:
- v2: learning from my corrections, recurring reminders, grocery staples, icon shortcuts, a brain-dump paste plus a one-time import of my exported WhatsApp-to-self chat, nightly backup, archive search, no work notifications in evenings and at weekends.
- v3: native Android via Capacitor, with a home-screen widget or quick-settings tile for capture and on-device reminders.

## 9. Working rules
- Work in milestones (section 10). At the end of each milestone, stop and post in this chat: what's done, a click-by-click test checklist for my phone, and known issues. Wait for my feedback before starting the next milestone, and update `docs/PROGRESS.md`.
- Only ask me questions at the end of a milestone, for one-time manual setup steps, or when something in this spec turns out impossible or involves a real trade-off. Otherwise decide yourself and log it in `docs/DECISIONS.md`.
- If something in this spec is impossible on Android/Chrome (e.g. opening the keyboard automatically), tell me and propose the closest alternative. Never silently change behavior.
- I don't run commands locally. Manual steps happen only in a browser (GitHub settings, Cloudflare dashboard, Anthropic Console) or on my phone, and you give me exact click-by-click instructions. Prefer automating one-time setup with a manually triggered GitHub Actions workflow.
- Secrets: never commit them. List every secret, where it is created and where it goes (GitHub Actions secret or Worker secret). If one has to be generated (the app token, VAPID keys), generate it in your workspace, show it to me once so I can paste it into GitHub settings, and never store it in the repo.
- Keep dependencies minimal, and check that everything used in the Worker runs on the Workers runtime.
- Performance budget: from tapping the app icon to typing within about 1 second on my phone after the first load; frontend JavaScript under about 80 KB gzipped; no web fonts. Measure this in M5.
- Tests (Vitest) are required for the parts that break silently: the device time parser (Dutch and English, relative times, both daylight-saving changes in Europe/Amsterdam), vague-time mapping, fading rules, last-write-wins merging, reminder selection and `notifiedAt` idempotency, grocery de-duplication, and validation of LLM output against recorded fixtures. CI never calls the real LLM.
- Add an eval set of about 30 realistic mixed Dutch/English captures with expected output, plus a manually triggered workflow that runs them against the real API and reports mismatches, so the prompt can be tuned.
- Keep `README.md` up to date with: what the app is, the architecture, setup, how to rotate the token, how to change settings, and the costs.

## 10. Milestones
- M0 – Bootstrap: create the repo, repo structure (`app/`, `worker/`, `docs/`), CI (typecheck, lint, tests), deploy workflows, and a setup guide for the one-time steps (free Cloudflare account, API token and account ID, D1 database, Anthropic API key with credit, GitHub Pages source set to GitHub Actions, all secrets). A placeholder app I can install from Chrome that opens offline, and a Worker health endpoint checked by the smoke test. Phone test: install the app, then open it in airplane mode.
- M1 – Capture: input, local save, offline use, tabs, prefixes, device parser with provisional items, share target, setup link and auth, sync to D1, toast with fix/undo, export, laptop view. Phone test: capture something offline, go back online, see it on the laptop.
- M2 – Reminders: push subscription, per-minute cron, Urgency high, notification buttons working from the service worker, snooze sheet, the "not scheduled" warning, late reminders. Include a Samsung checklist: allow notifications for Chrome, set Chrome's battery usage to Unrestricted and keep Chrome out of sleeping apps. Phone tests: "over 2 min test" with the phone locked; a reminder 30 minutes ahead with the phone idle; one overnight reminder at 07:45.
- M3 – LLM sorting: Haiku integration following the contract, splitting, grocery canonical names, sections and merging, retries via the cron, daily cap, LLM toggle, eval set and workflow. Phone test: a list of mixed captures for me to type, with expected results.
- M4 – Self-cleaning, digest, settings: fading job and archive, morning digest, settings screen synced through the server. Phone test: with a temporary short fading setting, watch items fade; receive a digest.
- M5 – Polish: performance budget measured, error and offline states, basic accessibility, README complete. Phone test: a normal day of use.

Start with section 0, then M0.