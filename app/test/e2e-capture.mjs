// End-to-end check of M1 in real Chrome against a real local Worker (wrangler dev
// with a local D1): capture offline on a "phone", come back online, see it on a
// "laptop". Also: toast fix and undo, share target, export. `npm run e2e -w app`.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const APP = 'http://localhost:4173/unforget/';
const API = 'http://localhost:8787';
const TOKEN = 'e2e-token';
const SETUP = `${APP}#setup=${TOKEN}&api=${API}`;
const workerDir = join(import.meta.dirname, '..', '..', 'worker');
const state = mkdtempSync(join(tmpdir(), 'unforget-e2e-'));
const quiet = { cwd: workerDir, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } };

function step(name) {
  console.log(`  · ${name}`);
}

async function waitForWorker() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok && (await res.json()).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('local Worker did not start');
}

const migrate = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'unforget', '--local', '--persist-to', state], { ...quiet, encoding: 'utf8' });
if (migrate.status !== 0) {
  console.error(migrate.stdout, migrate.stderr);
  process.exit(1);
}
const wrangler = spawn(
  'npx',
  ['wrangler', 'dev', '--port', '8787', '--persist-to', state, '--var', `APP_TOKEN:${TOKEN}`, '--var', 'ALLOWED_ORIGINS:http://localhost:4173', '--var', 'VERSION:e2e'],
  { ...quiet, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
);
let workerLog = '';
wrangler.stdout.on('data', (d) => (workerLog += d));
wrangler.stderr.on('data', (d) => (workerLog += d));

const server = await preview({ preview: { port: 4173, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
let failed = false;

async function device(name) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    failed = true;
    console.error(`[${name}] page error:`, e.message);
  });
  const box = page.getByLabel('Capture');
  const tab = (t) => page.getByRole('navigation').getByRole('button', { name: t }).click();
  const capture = async (text) => {
    await box.fill(text);
    await box.press('Enter');
  };
  const status = page.getByLabel('Sync status and more');
  const synced = () => page.waitForSelector('button.status[data-sync="idle"][data-waiting="0"]', { timeout: 15000 });
  return { context, page, box, tab, capture, status, synced };
}

const see = (page, text) => page.getByText(text, { exact: true }).first().waitFor({ timeout: 10000 });
const gone = (page, text) => page.getByText(text, { exact: true }).first().waitFor({ state: 'detached', timeout: 10000 });

try {
  await waitForWorker();

  step('phone: setup link connects and the token leaves the address bar');
  const phone = await device('phone');
  await phone.page.goto(SETUP);
  await phone.synced();
  if (phone.page.url() !== APP) throw new Error(`setup fragment still in URL: ${phone.page.url()}`);
  if (!(await phone.box.evaluate((el) => el === document.activeElement))) throw new Error('capture box is not focused on open');

  step('phone: capture offline, with a prefix and a relative time');
  await phone.context.setOffline(true);
  await phone.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await phone.capture('over 10 minuten oven uit');
  await phone.page.getByText(/^Saved → Personal · ⏰ \d\d:\d\d · oven uit/).waitFor({ timeout: 5000 });
  if ((await phone.box.inputValue()) !== '') throw new Error('box was not cleared');
  if (!(await phone.box.evaluate((el) => el === document.activeElement))) throw new Error('box lost focus after saving');
  await phone.capture('G Ketchup');
  await phone.page.getByText('Saved → Groceries · Ketchup').waitFor({ timeout: 5000 });
  await phone.capture('w kwartaalcijfers nakijken');
  await phone.status.getByText('Offline · 6 waiting').waitFor({ timeout: 5000 });
  await see(phone.page, 'oven uit'); // has a reminder today, so it is on Today

  step('phone: still there after closing and reopening offline');
  await phone.page.reload();
  await see(phone.page, 'oven uit');
  await phone.tab('Groceries');
  await see(phone.page, 'Ketchup');
  await phone.tab('Work');
  await see(phone.page, 'kwartaalcijfers nakijken');

  step('phone: back online, everything syncs');
  await phone.context.setOffline(false);
  await phone.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await phone.synced();

  step('laptop: sees what the phone captured');
  const laptop = await device('laptop');
  await laptop.page.goto(SETUP);
  await laptop.synced();
  await see(laptop.page, 'oven uit');
  await laptop.tab('Groceries');
  await see(laptop.page, 'Ketchup');

  step('laptop: ticks the grocery; phone shows it under Recent after syncing');
  await laptop.page.getByLabel('Mark done: Ketchup').click();
  await laptop.page.getByText('Done · Ketchup').waitFor({ timeout: 5000 });
  await laptop.synced();
  await phone.page.reload();
  await phone.synced();
  await phone.tab('Groceries');
  await phone.page.locator('.recent button', { hasText: 'Ketchup' }).waitFor({ timeout: 10000 });

  step('phone: re-add from Recent');
  await phone.page.locator('.recent button', { hasText: 'Ketchup' }).click();
  await phone.page.getByLabel('Mark done: Ketchup').waitFor({ timeout: 5000 });

  step('phone: undo removes a capture');
  await phone.capture('p vergissing');
  await phone.page.getByRole('button', { name: 'Undo' }).click();
  await phone.tab('Personal');
  await gone(phone.page, 'vergissing');

  step('phone: tap the toast to fix the list and the title');
  await phone.capture('w taart bestellen');
  await phone.page.getByText('Tap to fix').click();
  const dialog = phone.page.getByRole('dialog', { name: 'Fix item' });
  await dialog.getByLabel('Title').fill('taart bestellen voor zaterdag');
  await dialog.getByText('Personal', { exact: true }).click();
  await dialog.getByLabel('Deadline').fill('2026-12-05');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await phone.tab('Personal');
  await see(phone.page, 'taart bestellen voor zaterdag');
  await phone.page.getByText(/^due /).first().waitFor({ timeout: 5000 });
  await phone.synced();

  step('laptop: gets the fix, not the undone capture');
  await laptop.page.reload();
  await laptop.synced();
  await laptop.tab('Personal');
  await see(laptop.page, 'taart bestellen voor zaterdag');
  if (await laptop.page.getByText('vergissing').count()) throw new Error('undone capture reached the laptop');

  step('share target: shared text is saved as a capture');
  await phone.page.goto(`${APP}?share_title=Recept&share_text=${encodeURIComponent('Recept https://example.com/pasta')}`);
  await phone.page.getByText('Saved → Personal · Recept https://example.com/pasta').waitFor({ timeout: 5000 });
  if (phone.page.url() !== APP) throw new Error(`share parameters still in URL: ${phone.page.url()}`);
  await phone.page.reload();
  await phone.tab('Personal');
  if ((await phone.page.getByText('Recept https://example.com/pasta', { exact: true }).count()) !== 1) throw new Error('reload repeated the shared capture');

  step('export: downloads everything, including raw text of the undone capture');
  await phone.status.click();
  const [download] = await Promise.all([phone.page.waitForEvent('download'), phone.page.getByRole('button', { name: 'Export everything (JSON)' }).click()]);
  const data = JSON.parse(readFileSync(await download.path(), 'utf8'));
  if (data.captures.length !== 6 || data.items.length !== 6) throw new Error(`export has ${data.captures.length} captures, ${data.items.length} items`);
  if (!data.captures.some((c) => c.text === 'p vergissing' && c.deletedAt)) throw new Error('export lost the undone capture');
  if (!data.captures.some((c) => c.text === 'G Ketchup')) throw new Error('raw capture text was changed');

  step('server: rejects a wrong token, and the app says so');
  const stranger = await device('stranger');
  await stranger.page.goto(`${APP}#setup=wrong&api=${API}`);
  await stranger.status.getByText('Reconnect needed').waitFor({ timeout: 10000 });

  if (failed) throw new Error('page errors (see above)');
  console.log('e2e capture: ok');
} catch (err) {
  failed = true;
  console.error('e2e capture: FAILED\n', err);
  console.error('--- worker log ---\n' + workerLog.slice(-3000));
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
  try {
    process.kill(-wrangler.pid, 'SIGTERM');
  } catch {
    // already gone
  }
  rmSync(state, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
