// End-to-end check that after one visit the app opens, and captures, with no network. Runs the production build in real Chrome. `npm run e2e -w app`.
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4173, strictPort: true }, logLevel: 'silent' });
const url = 'http://localhost:4173/unforget/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
let failed = false;

try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, permissions: ['notifications'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(url);
  // Wait until the service worker has cached the shell and controls the page.
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => Boolean(navigator.serviceWorker.controller)), null, { timeout: 15000 });

  const cacheNames = await page.evaluate(() => caches.keys());
  if (!cacheNames.every((n) => n.startsWith('unforget-'))) throw new Error(`unexpected cache names: ${cacheNames}`);

  // A push message becomes a notification with the two action buttons.
  const cdp = await context.newCDPSession(page);
  const registrationId = await new Promise((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => e.registrations[0] && resolve(e.registrations[0].registrationId));
    void cdp.send('ServiceWorker.enable');
  });
  const push = {
    kind: 'reminder',
    title: 'oven uit',
    body: '⏰ 14:13 · Personal',
    tag: 'item-1',
    itemId: '1',
    actions: [
      { action: 'done', title: 'Done' },
      { action: 'snooze:1h', title: 'Snooze 1h' },
    ],
  };
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: 'http://localhost:4173', registrationId, data: JSON.stringify(push) });
  await page.waitForFunction(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length === 1, null, { timeout: 5000 });
  const shown = await page.evaluate(async () => {
    const [n] = await (await navigator.serviceWorker.ready).getNotifications();
    return { title: n.title, body: n.body, tag: n.tag, itemId: n.data.itemId, actions: n.actions.map((a) => a.action) };
  });
  const expected = { title: 'oven uit', body: '⏰ 14:13 · Personal', tag: 'item-1', itemId: '1', actions: ['done', 'snooze:1h'] };
  if (JSON.stringify(shown) !== JSON.stringify(expected)) throw new Error(`notification was ${JSON.stringify(shown)}`);

  await context.setOffline(true);
  await page.reload();
  await page.getByLabel('Capture').waitFor({ timeout: 15000 });
  await page.getByLabel('Capture').fill('p offline note');
  await page.getByLabel('Capture').press('Enter');
  await page.getByText('Saved → Personal · offline note').waitFor({ timeout: 5000 });

  // The setup link and share target add a fragment or query; the shell must still load.
  await page.goto(`${url}?source=share#other`);
  await page.getByLabel('Capture').waitFor({ timeout: 15000 });

  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
  console.log('e2e offline: ok');
} catch (err) {
  failed = true;
  console.error('e2e offline: FAILED\n', err);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
process.exit(failed ? 1 : 0);
