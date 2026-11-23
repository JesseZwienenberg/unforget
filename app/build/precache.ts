// Builds the list of files the service worker precaches, plus a version that
// changes whenever any of them changes. Kept free of Vite so it can be tested.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface BuiltFile {
  /** Path relative to the build output, with forward slashes. */
  path: string;
  content: Uint8Array;
}

export interface Precache {
  version: string;
  /** URLs relative to the service worker scope. './' is the app shell (index.html). */
  urls: string[];
}

const SKIP = [/^sw\.js$/, /\.map$/, /(^|\/)\.[^/]+$/];

export function buildPrecache(files: BuiltFile[]): Precache {
  const kept = files.filter((f) => !SKIP.some((re) => re.test(f.path))).sort((a, b) => (a.path < b.path ? -1 : 1));
  const hash = createHash('sha256');
  for (const f of kept) {
    hash.update(f.path);
    hash.update('\0');
    hash.update(f.content);
    hash.update('\0');
  }
  const urls = kept.map((f) => (f.path === 'index.html' ? './' : f.path));
  return { version: hash.digest('hex').slice(0, 12), urls };
}

export function readBuiltFiles(dir: string): BuiltFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const full = join(e.parentPath, e.name);
      return { path: relative(dir, full).split(sep).join('/'), content: readFileSync(full) };
    });
}

/** Replaces the two placeholders in the built service worker. Throws if they are missing. */
export function injectPrecache(swSource: string, precache: Precache): string {
  for (const token of ['__UF_PRECACHE__', '__UF_VERSION__']) {
    if (!swSource.includes(token)) throw new Error(`service worker is missing ${token}`);
  }
  return swSource
    .replaceAll('__UF_PRECACHE__', JSON.stringify(precache.urls))
    .replaceAll('__UF_VERSION__', JSON.stringify(precache.version));
}

export function finalizeServiceWorker(outDir: string): Precache {
  const precache = buildPrecache(readBuiltFiles(outDir));
  const swPath = join(outDir, 'sw.js');
  writeFileSync(swPath, injectPrecache(readFileSync(swPath, 'utf8'), precache));
  return precache;
}
