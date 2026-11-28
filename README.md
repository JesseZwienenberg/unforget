# Unforget

A one-box capture app for one person. Type anything, in Dutch or English, press enter, done.
The app splits it into items, files them under Work, Personal or Groceries, and turns any
time it finds into a reminder. Nothing needs organising: items with a time remind you,
items without one quietly fade away.

**Status:** v1 feature-complete (M0 to M5 built). See [docs/PROGRESS.md](docs/PROGRESS.md)
for what has been confirmed on the phone.

- App: https://jessezwienenberg.github.io/unforget/
- Full specification: [docs/SPEC.md](docs/SPEC.md)
- Why things are the way they are: [docs/DECISIONS.md](docs/DECISIONS.md)

## Architecture

```
app/      Svelte + Vite single-page app, installed as a PWA from Chrome.
          Static files on GitHub Pages under /unforget/. A service worker
          precaches the whole app, so it opens without any network.
shared/   Code used by both sides: data types, the on-device parser (list
          prefixes and "in 10 min" / "over een kwartier"), time-zone helpers,
          last-write-wins merge, input validation.
worker/   One Cloudflare Worker (TypeScript) with a D1 database, free plan.
          Does only what static hosting cannot: store data, keep secrets,
          run code at a set time.
scripts/  Deploy helpers and the smoke test, run by GitHub Actions.
docs/     Spec, decisions, progress, setup guide.
```

Every push to `main` runs `.github/workflows/deploy.yml`: typecheck, lint, tests, build, an
offline check in real Chrome, then deploy the app to GitHub Pages and the Worker to
Cloudflare (including D1 migrations), then a smoke test against the deployed Worker.

## How data flows

Everything is saved on the device first (IndexedDB), so capture never waits for the
network. Changed rows wait in an outbox and are sent to `POST /v1/sync`, which applies them
(last write wins per row) and returns everything changed since the device's cursor. The
raw text of every capture is kept forever.

## Reminders

A cron runs on the Worker every minute. It claims each due reminder (setting `notifiedAt`,
so nothing is ever sent twice) and sends a Web Push to every subscribed device. The
notification has two buttons, Done and Snooze 1h, which work without opening the app;
tapping the notification opens a snooze sheet. A reminder that reaches the server after its
time is sent at once, marked late. Phone settings that matter: [docs/PHONE.md](docs/PHONE.md).

## Sorting

New captures are sorted on the server by Claude Haiku (`claude-haiku-5-5`): split into
items, filed under Work, Personal or Groceries, titles cleaned (never translated), times
extracted, groceries given a canonical name, quantity and section. The model must answer
through a forced tool call and its answer is validated before anything is stored. Sorting
happens inside the sync request when it is fast enough (3.5 seconds); otherwise the phone's
provisional item stays and the cron retries. A prefix (`w `, `p `, `g `) always wins, and an
item you fixed by hand is never overwritten.

To tune the prompt (`worker/src/sort/prompt.ts`): run the **Eval sorting** workflow from the
Actions tab. It runs `evals/cases.ts` against the real API and lists mismatches in the run
summary.

## Self-cleaning and the morning digest

Nothing lives forever untouched. Every night at 03:00 local time the Worker archives items
whose time is up: undated Personal items after 14 days, undated Work items after 30, and
overdue items 7 days after their time. Groceries stay until ticked off. Archived is never
deleted: the settings screen lists the archive, and a tap restores an item with a fresh
clock. Snoozing, editing or re-adding an item also restarts its clock.

At the digest time (default 08:00) one notification lists today's reminders and deadlines,
overdue items and anything that fades within two days. It is skipped when there is nothing
to say.

## Setup

One-time, browser only: [docs/SETUP.md](docs/SETUP.md).

Each device is connected once by opening a setup link in Chrome:

```
https://jessezwienenberg.github.io/unforget/#setup=<APP_TOKEN>&api=https://unforget.jessez1997.workers.dev
```

The app stores the token on the device and removes it from the address bar.

## Using it

- Type and press enter. `w `, `p ` or `g ` at the start files it under Work, Personal or
  Groceries; without a prefix it goes to Personal.
- "in 10 min", "over een kwartier", "in an hour", "over 2 uur" set a reminder time at once;
  "morgen om 9", "vanavond", "voor vrijdag" and the like are understood a second later.
- Several things in one line ("melk, brood en bel de tandarts") become separate items.
- Tap the toast to fix the list, time or title; Undo removes the capture.
- Share text or a link from any Android app to Unforget to capture it.
- The dot in the top right shows sync status; tap it for Sync now, notifications and Export.
- Tap anywhere on empty space to bring up the keyboard.
- Swipe sideways, or tap the tabs above the box, to move between Today, Work, Personal and
  Groceries.
- Tap the circle to mark something done; tap the text to change it.

## Rotating the token

Replace the `APP_TOKEN` repository secret in GitHub and re-run the Deploy workflow. Details
at the bottom of [docs/SETUP.md](docs/SETUP.md).

## Changing settings

Tap the dot in the top right → **Open settings**. Everything there (vague times, time zone,
digest time and days, fading periods, notification buttons, snooze options, prefixes,
grocery sections, sorting and its daily limit) is saved on the server and synced to every
device. The one deploy-time setting is the list of allowed browser origins:
`ALLOWED_ORIGINS` in `worker/wrangler.jsonc`.

## Costs

| What                 | Cost                                                        |
| -------------------- | ----------------------------------------------------------- |
| GitHub Pages         | €0                                                          |
| Cloudflare Worker+D1 | €0 (free plan: 100,000 requests/day; the app uses a tiny fraction) |
| Claude Haiku         | About $0.0003 per capture; capped at 300 calls/day (≈ $0.10) |

The app shows the running total: tap the dot in the top right → **Spending** (today, this
month, all time). It is calculated from the tokens each capture used, at the prices in
`shared/src/cost.ts`; the Anthropic Console shows the real bill and the remaining credit.

## Performance

Budget: typing within about a second of tapping the icon, and under 80 KB of JavaScript
(gzipped). Before the box appears the app loads about 36 KB; the database code and the
sheets (another 38 KB) load right after. CI measures start-up on every push with the CPU
slowed four times: about 240 ms. On the phone, the More sheet shows "Ready to type in … ms"
for the current launch.

## If something is wrong

| What you see | What to do |
| --- | --- |
| "Not connected" | Open your setup link in Chrome on that device. |
| "Reconnect needed" | The token changed. Open a fresh setup link. |
| "Offline · 3 waiting" | Nothing is lost. It syncs when the connection is back. |
| "Sync problem" | Tap the dot: the message under **Sync** says what the server answered. |
| A reminder did not arrive | Tap the dot → **Send a test notification**, then follow [docs/PHONE.md](docs/PHONE.md). |
| An item is under the wrong list | Tap it and fix it; a manual fix is never overwritten. Tell Claude the text so it joins the eval set. |
| An item vanished after two weeks | It faded. Settings → **Archive** → tap it to restore. |
| The Deploy run is red | Open it in the Actions tab and give Claude the red line. |
| A new version does not show | Close the app and open it again (twice after a deploy). |

Everything you ever typed is in the export: Settings → **Export everything (JSON)**.

## Development

Requires Node 22 and Chrome. `npm ci`, then `npm run check` runs everything CI runs:
typecheck, lint, unit tests, build, and the end-to-end tests in Chrome.
