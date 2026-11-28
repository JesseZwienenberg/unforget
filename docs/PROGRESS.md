# Progress

## Done

- **M0 – Bootstrap** (accepted 26 Nov 2026).
- **M1 – Capture** (accepted 27 Nov 2026). Finding: no automatic keyboard on a cold start; handled with tap-anywhere-to-type.
- **M3 – LLM sorting** (in use since 27 Nov; Jesse asked to start M4 on 28 Nov). Follow-ups done: no list jump while sorting, capitalised titles, spending overview, grocery rename fix. Eval set: 38 of 38.

## Not yet confirmed

- **M2 – Reminders**: deployed 27 Nov. Jesse has not finished the phone tests (locked phone, 30 min idle, overnight 07:45) and assumes they work. If he reports a missed reminder, start from More → "Send a test notification" and docs/PHONE.md.

## In progress

**M4 – Self-cleaning, digest, settings**: built and deployed; waiting for Jesse's phone test.

What exists for M4:
- Shared: `fading.ts` (rules), `digest.ts` (content, timing), `today.ts`, strict settings sanitising and validation.
- Worker: `maintenance.ts` (nightly clean-up at 03:00 local, morning digest), `POST /v1/cleanup`; both run inside the per-minute cron after reminders and sorting.
- App: settings screen (vague times, time zone, digest, fading, notification buttons, snooze options, prefixes, grocery sections, sorting switch and daily limit), archive with restore, "Clean up now", export.

Live addresses:
- App: https://jessezwienenberg.github.io/unforget/
- Worker: https://unforget.jessez1997.workers.dev

## Exact next step

1. Jesse does the M4 phone test (fading with a temporary 0-day setting, digest at a temporary time, settings sync) and reports back.
2. Fix what he reports.
3. On his OK: mark M4 done and start M5 (polish). First M5 tasks: measure icon-to-typing time on the phone (add a small timing readout), load settings/More sheets on demand to get JavaScript back under about 60 KB, error and offline states review, accessibility pass, README completion.

## Useful commands

- Start the eval run: `gh api -X POST repos/JesseZwienenberg/unforget/actions/workflows/eval.yml/dispatches -f ref=main`
- Read a run: `gh run view <id> -R JesseZwienenberg/unforget --log`

## Known issues

- Real push delivery is only fully proven by the M2 phone tests, which are not finished.
- Undo after a grocery merge does not lower the merged quantity again.
- Items created before 27 Nov keep a lowercase first letter.
- Frontend JavaScript is about 71 KB gzipped of the 80 KB budget.
