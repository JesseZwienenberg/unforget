// Deploy step 1: make sure the D1 database exists, write its id into
// worker/wrangler.jsonc (in this checkout only) and work out the Worker's URL.
// This replaces the manual "create a D1 database" step.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { cf, replaceDatabaseId, workerUrl } from './cloudflare.mjs';

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const DB_NAME = 'unforget';
const WORKER_NAME = 'unforget';
const CONFIG = new URL('../worker/wrangler.jsonc', import.meta.url);

const found = await cf(`/accounts/${account}/d1/database?name=${DB_NAME}`, { token });
let db = found.find((d) => d.name === DB_NAME);
if (db) {
  console.log(`D1 database "${DB_NAME}" exists.`);
} else {
  db = await cf(`/accounts/${account}/d1/database`, {
    token,
    method: 'POST',
    body: { name: DB_NAME, primary_location_hint: 'weur' },
  });
  console.log(`Created D1 database "${DB_NAME}".`);
}
writeFileSync(CONFIG, replaceDatabaseId(readFileSync(CONFIG, 'utf8'), db.uuid));

let subdomain;
try {
  subdomain = (await cf(`/accounts/${account}/workers/subdomain`, { token })).subdomain;
} catch (err) {
  console.error(String(err));
}
if (!subdomain) {
  console.error(
    '::error::Your Cloudflare account has no workers.dev subdomain yet. Open the Cloudflare dashboard → Workers & Pages once (see docs/SETUP.md, step 1), then re-run this workflow.',
  );
  process.exit(1);
}
const url = workerUrl(WORKER_NAME, subdomain);
console.log(`Worker URL: ${url}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `worker_url=${url}\n`);
