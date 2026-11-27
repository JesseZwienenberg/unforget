// End-to-end check of M1 in real Chrome against a real local Worker (wrangler dev
// with a local D1): capture offline on a "phone", come back online, see it on a
// "laptop". Also: toast fix and undo, share target, export. `npm run e2e -w app`.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
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
// A stand-in for the Anthropic API. It answers only captures that start with "sorteer",
// so the rest of this test keeps exercising the provisional (model unavailable) path.
const modelCalls = [];
const model = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const request = JSON.parse(body);
    const capture = /<capture>\n([\s\S]*)\n<\/capture>/.exec(request.messages[0].content)?.[1] ?? '';
    modelCalls.push({ capture, key: req.headers['x-api-key'], model: request.model });
    if (!capture.startsWith('sorteer')) {
      res.writeHead(529).end('overloaded');
      return;
    }
    const item = (title, extra) => ({ title, list: 'personal', remindAt: null, dueAt: null, grocery: null, confidence: 0.95, ...extra });
    const grocery = (name, canonicalName, section) => item(name, { list: 'groceries', grocery: { canonicalName, displayName: name, quantity: null, section } });
    const items = [grocery('melk', 'milk', 'Dairy & eggs'), grocery('brood', 'bread', 'Bread & bakery'), item('tandarts bellen', { remindAt: '2030-01-07T07:45:00+01:00' })];
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'tool_use', id: 't1', name: 'file_items', input: { items } }] }));
  });
}).listen(8788);

const wrangler = spawn(
  'npx',
  ['wrangler', 'dev', '--port', '8787', '--persist-to', state, '--var', `APP_TOKEN:${TOKEN}`, '--var', 'ALLOWED_ORIGINS:http://localhost:4173', '--var', 'VERSION:e2e', '--var', 'ANTHROPIC_API_KEY:e2e-key', '--var', 'ANTHROPIC_BASE_URL:http://localhost:8788'],
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
  const box = page.getByLabel('Capture', { exact: true });
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
  await phone.page.locator('.toast').getByText('not scheduled yet: offline').waitFor({ timeout: 5000 });
  if ((await phone.box.inputValue()) !== '') throw new Error('box was not cleared');
  if (!(await phone.box.evaluate((el) => el === document.activeElement))) throw new Error('box lost focus after saving');
  await phone.capture('G Ketchup');
  await phone.page.getByText('Saved → Groceries · Ketchup').waitFor({ timeout: 5000 });
  await phone.capture('w kwartaalcijfers nakijken');
  await phone.status.getByText('Offline · 6 waiting').waitFor({ timeout: 5000 });
  await see(phone.page, 'oven uit'); // has a reminder today, so it is on Today
  await phone.page.locator('li').getByText('not scheduled yet: offline').waitFor({ timeout: 5000 });

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
  if (await phone.page.getByText('not scheduled yet').count()) throw new Error('"not scheduled" warning stayed after syncing');

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

  step('notification tap: opens the snooze sheet for that item');
  const server = (body) =>
    fetch(`${API}/v1/sync`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) }).then((r) => r.json());
  const oven = (await server({ since: 0 })).items.find((i) => i.title === 'oven uit');
  await phone.page.goto(`${APP}?item=${oven.id}`);
  const sheet = phone.page.getByRole('dialog', { name: 'Snooze' });
  await sheet.getByText('oven uit').waitFor({ timeout: 10000 });
  if (phone.page.url() !== APP) throw new Error(`item parameter still in URL: ${phone.page.url()}`);
  await sheet.getByRole('button', { name: /Tomorrow morning/ }).click();
  await phone.page.getByText(/^Snoozed → ⏰ tomorrow 07:45 · oven uit/).waitFor({ timeout: 5000 });
  await phone.synced();
  const snoozed = (await server({ since: 0 })).items.find((i) => i.id === oven.id);
  if (!/T0[56]:45:00\.000Z$/.test(snoozed.remindAt)) throw new Error(`snooze did not reach the server: ${snoozed.remindAt}`);

  step('notification button: Done on the server shows up in the app');
  const acted = await fetch(`${API}/v1/items/${oven.id}/action`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ action: 'done' }) });
  if (acted.status !== 200) throw new Error(`action endpoint said ${acted.status}`);
  await phone.page.reload();
  await phone.synced();
  await phone.tab('Personal');
  await gone(phone.page, 'oven uit');

  step('smart sorting: one capture becomes three sorted items, and the toast follows');
  await phone.tab('Today');
  await phone.capture('sorteer melk, brood en maandag tandarts bellen');
  await phone.page.getByText('Saved → 3 items · melk · brood · tandarts bellen').waitFor({ timeout: 10000 });
  await phone.tab('Groceries');
  await phone.page.getByRole('heading', { name: 'Dairy & eggs' }).waitFor({ timeout: 5000 });
  await phone.page.getByRole('heading', { name: 'Bread & bakery' }).waitFor({ timeout: 5000 });
  await phone.page.getByLabel('Mark done: melk').waitFor({ timeout: 5000 });
  await phone.tab('Personal');
  await see(phone.page, 'tandarts bellen');
  await phone.page.getByText('⏰ Mon 7 Jan 2030 07:45').waitFor({ timeout: 5000 });
  const sortCall = modelCalls.find((c) => c.capture.startsWith('sorteer'));
  if (sortCall?.key !== 'e2e-key' || sortCall?.model !== 'claude-haiku-5-5') throw new Error(`unexpected model call: ${JSON.stringify(sortCall)}`);

  step('smart sorting: the same grocery again raises the quantity instead of adding a line');
  await phone.capture('sorteer melk, brood en maandag tandarts bellen');
  await phone.synced();
  await phone.tab('Groceries');
  await phone.page.getByLabel('Mark done: melk × 2').waitFor({ timeout: 10000 });
  if ((await phone.page.getByLabel(/^Mark done: melk/).count()) !== 1) throw new Error('duplicate grocery line');

  step('smart sorting: switched off, the model is not called');
  await phone.status.click();
  await phone.page.getByLabel('Sort captures automatically').uncheck();
  await phone.page.keyboard.press('Escape');
  await phone.page.getByRole('dialog', { name: 'Unforget' }).waitFor({ state: 'hidden' });
  await phone.synced();
  const before = modelCalls.length;
  await phone.capture('sorteer dit niet');
  await phone.synced();
  await phone.page.waitForTimeout(500);
  if (modelCalls.length !== before) throw new Error('model was called while sorting is off');
  await phone.status.click();
  await phone.page.getByLabel('Sort captures automatically').check();
  await phone.page.keyboard.press('Escape');
  await phone.page.getByRole('dialog', { name: 'Unforget' }).waitFor({ state: 'hidden' });
  await phone.synced();

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
  if (data.captures.length !== 9) throw new Error(`export has ${data.captures.length} captures`);
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
  model.close();
  try {
    process.kill(-wrangler.pid, 'SIGTERM');
  } catch {
    // already gone
  }
  rmSync(state, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
