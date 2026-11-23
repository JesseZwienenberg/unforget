export interface Env {
  DB: D1Database;
  /** Comma-separated list of browser origins allowed by CORS. */
  ALLOWED_ORIGINS: string;
  /** Git commit the Worker was deployed from (set by the deploy workflow). */
  VERSION?: string;
  /** Secret: the single bearer token. */
  APP_TOKEN?: string;
}
