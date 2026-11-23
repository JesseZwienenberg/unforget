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

## Later

Nothing yet.
