# Unforget

A one-box capture app for one person. Type anything, in Dutch or English, press enter, done.
The app splits it into items, files them under Work, Personal or Groceries, and turns any
time it finds into a reminder. Nothing needs organising: items with a time remind you,
items without one quietly fade away.

**Status:** M2 (reminders). Capturing, lists, sync, share target, export and reminder
notifications work; smart sorting comes in M3. See [docs/PROGRESS.md](docs/PROGRESS.md).

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
- "in 10 min", "over een kwartier", "in an hour", "over 2 uur" set a reminder time.
- Tap the toast to fix the list, time or title; Undo removes the capture.
- Share text or a link from any Android app to Unforget to capture it.
- The dot in the top right shows sync status; tap it for Sync now, notifications and Export.
- Tap anywhere on empty space to bring up the keyboard.

## Rotating the token

Replace the `APP_TOKEN` repository secret in GitHub and re-run the Deploy workflow. Details
at the bottom of [docs/SETUP.md](docs/SETUP.md).

## Changing settings

App settings (time zone, vague times, digest, fading, prefixes, grocery sections) will be
edited in the app's Settings screen from M4. The one deploy-time setting is the list of
allowed browser origins: `ALLOWED_ORIGINS` in `worker/wrangler.jsonc`.

## Costs

| What                 | Cost                                                        |
| -------------------- | ----------------------------------------------------------- |
| GitHub Pages         | €0                                                          |
| Cloudflare Worker+D1 | €0 (free plan: 100,000 requests/day; the app uses a tiny fraction) |
| Claude Haiku (M3)    | Expected well under €1/month, capped at 300 calls/day       |

## Development

Requires Node 22 and Chrome. `npm ci`, then `npm run check` runs everything CI runs:
typecheck, lint, unit tests, build, and the end-to-end tests in Chrome.
