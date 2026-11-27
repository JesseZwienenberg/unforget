# Progress

## Done

- **M0 – Bootstrap** (accepted 26 Nov 2026).
- **M1 – Capture** (accepted 27 Nov 2026). Finding: no automatic keyboard on a cold start; handled with tap-anywhere-to-type.

## In progress

**M2 – Reminders**: deployed 27 Nov; Jesse said "proceed" before reporting on the phone tests (the overnight one could not have run yet). Treat M2 as not yet confirmed: ask for the results.

**M3 – LLM sorting**: built and deployed; waiting for Jesse's phone test.

What exists for M3:
- Worker: `worker/src/sort/` (prompt + forced tool for `claude-haiku-5-5`, output validation, claim → call → settle → apply, grocery merge, retries with backoff, daily cap), migration `0004_sorting.sql`, sorting inside the sync request (3.5 s limit) and in the cron.
- App: toast refreshes when the sorted result arrives; "Sort captures automatically" switch in the More sheet.
- Evals: `evals/cases.ts` (32 cases), `evals/sorting.eval.ts`, workflow "Eval sorting" (manual).
- Tests: unit tests on real SQLite for sorting, merging, retries, cap; Chrome e2e with a stand-in model.

Live addresses:
- App: https://jessezwienenberg.github.io/unforget/
- Worker: https://unforget.jessez1997.workers.dev

## Exact next step

1. Run the "Eval sorting" workflow against the real API, read the mismatches, tune `worker/src/sort/prompt.ts`, and replace the hand-written fixtures with recorded answers. (See the latest chat message for whether this has been done.)
2. Jesse does the M3 phone test (list of captures with expected results) and reports on the M2 tests.
3. Fix what he reports.
4. On his OK: mark M2 and M3 done here and start M4 (self-cleaning, digest, settings screen). First M4 tasks: fading rules as a pure function with tests, nightly job inside the cron at 03:00 local, digest content + push, settings screen.

## Known issues

- Real push delivery and real model answers are only fully proven by the phone tests and the eval workflow.
- Undo after a grocery merge does not lower the merged quantity again.
- An already-installed app picks up the share target only after Chrome refreshes the install (up to a day) or after reinstalling.
