# Progress

## Done

- **M0 – Bootstrap** (accepted 26 Nov 2026).
- **M1 – Capture** (accepted 27 Nov 2026). Phone test passed. One finding: the keyboard does not open by itself on a cold start (it does when returning to the app); handled with tap-anywhere-to-type, see DECISIONS.

## In progress

**M2 – Reminders**: built and deployed; waiting for Jesse's phone tests.

What exists:
- Worker: Web Push (VAPID, Urgency high, TTL 12 h), `push_subscriptions` (migration 0003), per-minute cron, claim-then-send with `notifiedAt`, late and stale handling, `POST /v1/items/:id/action` for notification buttons, push key/subscribe/unsubscribe/test endpoints.
- App: turn-on-notifications banner and More section with test button, service worker push + notification buttons (Done, Snooze 1h) + tap-to-open, snooze sheet, "not scheduled yet: offline" warning, tap anywhere to focus the box.
- Docs: `docs/PHONE.md` (Samsung checklist).
- Tests: 218 unit tests (reminder selection, idempotency, late, snooze presets across DST, push encryption round trip); Chrome e2e covers snooze sheet, warnings, action endpoint and the push handler.

Live addresses:
- App: https://jessezwienenberg.github.io/unforget/
- Worker: https://unforget.jessez1997.workers.dev

## Exact next step

1. Jesse does the Samsung checklist and the three M2 phone tests ("over 2 min test" with the phone locked; 30 minutes ahead with the phone idle; overnight at 07:45) and reports back.
2. Fix whatever he reports (delivery problems: start from the "Send a test notification" message).
3. On his OK: mark M2 done here and start M3 (LLM sorting). First M3 tasks: Jesse adds the `ANTHROPIC_API_KEY` secret (SETUP.md step 5); design the prompt and tool schema for `claude-haiku-5-5`; `llm_usage` migration; sorting inside sync with a timeout; cron retries; eval set and workflow.

## Known issues

- Real push delivery (through Google's push service to the phone) has only been tested up to the encrypted request; the phone tests are the first full run.
- An already-installed app picks up the share target only after Chrome refreshes the install (up to a day) or after reinstalling.
- Without a prefix everything lands in Personal until M3.
