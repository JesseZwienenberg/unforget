// Deploy step: prints the Worker secrets as JSON for `wrangler secret bulk`.
// GitHub Actions secrets are the single place secrets are entered; this copies
// them to the Worker on every deploy, which is also how a token is rotated.
import { pickSecrets } from './cloudflare.mjs';

export const WORKER_SECRETS = ['APP_TOKEN', 'ANTHROPIC_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];

process.stdout.write(JSON.stringify(pickSecrets(process.env, WORKER_SECRETS)));
