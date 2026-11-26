// What the app was opened with: a one-time setup link, or text shared from another app.
import type { Config } from './storage/types';

/** Reads `#setup=<token>&api=<worker-url>`. Returns null when the fragment is something else or malformed. */
export function parseSetupLink(hash: string): Config | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('setup')?.trim();
  const api = params.get('api')?.trim();
  if (!token || !api) return null;
  let url: URL;
  try {
    url = new URL(api);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
  return { token, api: url.origin + url.pathname.replace(/\/+$/, '') };
}

export const SHARE_PARAMS = { title: 'share_title', text: 'share_text', url: 'share_url' } as const;

/** Text shared through the Android share sheet (see share_target in the manifest), or null. */
export function parseShare(search: string): string | null {
  const params = new URLSearchParams(search);
  const title = params.get(SHARE_PARAMS.title)?.trim() ?? '';
  const text = params.get(SHARE_PARAMS.text)?.trim() ?? '';
  const url = params.get(SHARE_PARAMS.url)?.trim() ?? '';
  // Apps fill these inconsistently: the link is often inside `text`, and `title` often repeats it.
  const parts = [title, text, url].filter(Boolean);
  // Drop a part when another part already contains it (or an earlier one is identical).
  const kept = parts.filter((p, i) => !parts.some((q, j) => j !== i && q.includes(p) && (q !== p || j < i)));
  return kept.length ? kept.join(' ') : null;
}

/** The URL with setup and share details removed, so a reload or a screenshot never repeats or leaks them. */
export function cleanUrl(href: string): string {
  const url = new URL(href);
  for (const name of Object.values(SHARE_PARAMS)) url.searchParams.delete(name);
  if (parseSetupLink(url.hash)) url.hash = '';
  return url.pathname + url.search + url.hash;
}
