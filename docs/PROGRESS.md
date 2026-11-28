# Progress

## Done

- **M0 – Bootstrap** (accepted 26 Nov 2026).
- **M1 – Capture** (accepted 27 Nov 2026). Finding: no automatic keyboard on a cold start; handled with tap-anywhere-to-type.
- **M3 – LLM sorting** (in use since 27 Nov). Follow-ups done: no list jump while sorting, capitalised titles, spending overview, grocery rename fix. Eval set: 38 of 38.

## Not yet confirmed by a phone test

- **M2 – Reminders**: deployed 27 Nov. Jesse has not finished the phone tests (locked phone, 30 min idle, overnight 07:45) and assumes they work. If he reports a missed reminder, start from More → "Send a test notification" and docs/PHONE.md.
- **M4 – Self-cleaning, digest, settings**: deployed 28 Nov. Jesse asked to continue with M5 without reporting on the M4 phone test.

## In progress

**M5 – Polish**: built and deployed; waiting for Jesse's "normal day of use".

What was done for M5:
- Swipe sideways between tabs (Jesse's request).
- Start-up: database code and sheets load after first paint (about 36 KB gzipped before the box appears, 74 KB total); start-up time measured in CI (about 240 ms on a 4x-slowed CPU) and shown in the More sheet on the device.
- Error states: storage-refused banner; a capture that cannot be stored goes back into the box.
- Accessibility pass with a browser test for unnamed controls.
- README completed.

Live addresses:
- App: https://jessezwienenberg.github.io/unforget/
- Worker: https://unforget.jessez1997.workers.dev

## Exact next step

1. Jesse uses the app for a normal day and reports: anything slow or awkward, the "Ready to type in … ms" number from the More sheet, and the still-open M2 and M4 checks (a reminder with the phone locked, the overnight reminder, the digest, clean-up).
2. Fix what he reports.
3. v1 is then done. The spec's success test: two weeks later Jesse no longer texts himself on WhatsApp. v2 ideas are in SPEC.md section 8; do not start them without him asking.

## Useful commands

- Start the eval run: `gh api -X POST repos/JesseZwienenberg/unforget/actions/workflows/eval.yml/dispatches -f ref=main`
- Read a run: `gh run view <id> -R JesseZwienenberg/unforget --log`

## Known issues

- Real push delivery (reminders, digest) is only fully proven on the phone, and those tests are not finished.
- Undo after a grocery merge does not lower the merged quantity again.
- Items created before 27 Nov keep a lowercase first letter.
- The keyboard does not open by itself on a cold start (Android limit); tap anywhere.
- The installed app picks up a new version on the second open after a deploy.
