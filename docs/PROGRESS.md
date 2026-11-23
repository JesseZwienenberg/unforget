# Progress

## Done

Nothing accepted yet.

## In progress

**M0 – Bootstrap**: built and pushed; waiting for the one-time setup (docs/SETUP.md) and
the phone test.

What exists:
- Repo structure (`app/`, `worker/`, `scripts/`, `docs/`), npm workspaces.
- Placeholder PWA: installable, precaching service worker scoped to `/unforget/`, status screen.
- Worker: public `/health` (checks D1), token-protected `/v1/ping`, CORS allow list.
- D1 migration `0001_init.sql` (a `meta` table only).
- One workflow, `.github/workflows/deploy.yml`: checks, offline e2e, size budget, Pages
  deploy, D1 find-or-create, migrations, Worker deploy, secrets copy, smoke test.
- Secrets generated and shown to Jesse once in chat: `APP_TOKEN`, `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`.

## Exact next step

1. Jesse finishes docs/SETUP.md and runs the Deploy workflow; fix whatever is red.
2. Jesse does the M0 phone test (install from Chrome, open in airplane mode).
3. On his OK: mark M0 done here and start M1 (capture). First M1 task: design the D1 schema
   and the Dexie stores behind the storage interface, then the capture box.

## Known issues

- None known. The Cloudflare half of the workflow has not run yet (needs the secrets).
