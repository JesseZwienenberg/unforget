export interface Env {
  DB: D1Database;
  /** Comma-separated list of browser origins allowed by CORS. */
  ALLOWED_ORIGINS: string;
  /** Git commit the Worker was deployed from (set by the deploy workflow). */
  VERSION?: string;
  /** Contact URL or mailto: sent to push services with every notification. */
  VAPID_SUBJECT?: string;
  /** Secret: the single bearer token. */
  APP_TOKEN?: string;
  /** Secrets: the Web Push key pair. The public half is handed to the app. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Secret: Anthropic API key for sorting. Never sent to the browser. */
  ANTHROPIC_API_KEY?: string;
  /** Only for tests: where to reach the Anthropic API. */
  ANTHROPIC_BASE_URL?: string;
}
