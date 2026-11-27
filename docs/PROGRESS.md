# Progress

## Done

- **M0 – Bootstrap** (accepted 26 Nov 2026).
- **M1 – Capture** (accepted 27 Nov 2026). Finding: no automatic keyboard on a cold start; handled with tap-anywhere-to-type.

## In progress

**M2 – Reminders**: deployed 27 Nov. Jesse has not finished the phone tests and assumes they work; build on, but expect possible delivery reports later (start from "Send a test notification").

**M3 – LLM sorting**: built and deployed; waiting for Jesse's phone test.

What exists for M3:
- Worker: `worker/src/sort/` (prompt + forced tool for `claude-haiku-5-5`, output validation, claim → call → settle → apply, grocery merge, retries with backoff, daily cap), migration `0004_sorting.sql`, sorting inside the sync request (3.5 s limit) and in the cron.
- App: toast refreshes when the sorted result arrives; "Sort captures automatically" switch in the More sheet.
- Follow-up from Jesse's first feedback (27 Nov): captures wait up to 5 s for the sorter instead of jumping from Personal; titles start with a capital; Spending section in the More sheet (`GET /v1/usage`, migration `0005_usage.sql`).
- Evals: `evals/cases.ts` (36 cases), `evals/sorting.eval.ts`, workflow "Eval sorting" (manual).
- Tests: unit tests on real SQLite for sorting, merging, retries, cap; Chrome e2e with a stand-in model.

Live addresses:
- App: https://jessezwienenberg.github.io/unforget/
- Worker: https://unforget.jessez1997.workers.dev

## Exact next step

1. Jesse does the M3 phone test (list of captures with expected results, in the chat) and reports back. The eval set already scores 36 of 36 against the real model.
2. Fix what he reports: add each miss to `evals/cases.ts`, adjust `worker/src/sort/prompt.ts`, re-run "Eval sorting" (it can be started with `gh api -X POST repos/JesseZwienenberg/unforget/actions/workflows/eval.yml/dispatches -f ref=main`).
3. On his OK: mark M2 and M3 done here and start M4 (self-cleaning, digest, settings screen). First M4 tasks: fading rules as a pure function with tests, nightly job inside the cron at 03:00 local, digest content + push, settings screen.

## Known issues

- Real push delivery is only fully proven by the M2 phone tests, which are not finished.
- Undo after a grocery merge does not lower the merged quantity again.
- An already-installed app picks up the share target only after Chrome refreshes the install (up to a day) or after reinstalling.
