// End-to-end check that after one visit the app opens, and captures, with no network. Runs the production build in real Chrome. `npm run e2e -w app`.
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4173, strictPort: true }, logLevel: 'silent' });
const url = 'http://localhost:4173/unforget/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
let failed = false;

try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, permissions: ['notifications'], hasTouch: true });
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
  let shown = null;
  for (let i = 0; i < 50 && !shown; i++) {
    shown = await page.evaluate(async () => {
      const [n] = await (await navigator.serviceWorker.ready).getNotifications();
      return n ? { title: n.title, body: n.body, tag: n.tag, itemId: n.data.itemId, actions: n.actions.map((a) => a.action) } : null;
    });
    if (!shown) await page.waitForTimeout(100);
  }
  const expected = { title: 'oven uit', body: '⏰ 14:13 · Personal', tag: 'item-1', itemId: '1', actions: ['done', 'snooze:1h'] };
  if (JSON.stringify(shown) !== JSON.stringify(expected)) throw new Error(`notification was ${JSON.stringify(shown)}`);

  await context.setOffline(true);
  await page.reload();
  await page.getByLabel('Capture', { exact: true }).waitFor({ timeout: 15000 });
  await page.getByLabel('Capture', { exact: true }).fill('p offline note');
  await page.getByLabel('Capture', { exact: true }).press('Enter');
  await page.getByText('Saved → Personal · Offline note').waitFor({ timeout: 5000 });

  // The setup link and share target add a fragment or query; the shell must still load.
  await page.goto(`${url}?source=share#other`);
  await page.getByLabel('Capture', { exact: true }).waitFor({ timeout: 15000 });

  // Swiping sideways moves between tabs; scrolling up and down does not.
  const swipe = (dx, dy) =>
    page.evaluate(
      ([dx, dy]) => {
        const main = document.querySelector('main');
        const touch = (x, y) => new Touch({ identifier: 1, target: main, clientX: x, clientY: y });
        main.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(250, 300)], changedTouches: [touch(250, 300)], bubbles: true }));
        main.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(250 + dx, 300 + dy)], bubbles: true }));
      },
      [dx, dy],
    );
  const title = () => page.locator('header h1').innerText();
  const expectTab = async (name, after) => {
    if ((await title()) !== name) throw new Error(`after ${after}: expected tab ${name}, got ${await title()}`);
  };
  await expectTab('Today', 'opening');
  await swipe(-150, 10);
  await expectTab('Work', 'a swipe left');
  await swipe(-150, -10);
  await expectTab('Personal', 'a second swipe left');
  await swipe(-30, 200);
  await expectTab('Personal', 'scrolling down');
  await swipe(150, 0);
  await swipe(150, 0);
  await swipe(150, 0);
  await expectTab('Today', 'swiping right past the first tab');

  // Every button and field has a name a screen reader can say, on the main screen and in each sheet.
  const unnamed = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('button, input, select, textarea, a[href]')]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => !(el.getAttribute('aria-label') || el.labels?.length || el.innerText?.trim() || el.getAttribute('title')))
        .map((el) => el.outerHTML.slice(0, 120)),
    );
  const checkNames = async (where) => {
    const missing = await unnamed();
    if (missing.length) throw new Error(`controls without a name in ${where}: ${missing.join(' | ')}`);
  };
  await checkNames('the main screen');
  await page.getByLabel('Sync status and more').click();
  await page.getByRole('button', { name: 'Open settings' }).waitFor();
  await checkNames('the More sheet');
  const ready = await page.getByText(/Ready to type in \d+ ms/).innerText();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Save settings' }).waitFor();
  await checkNames('the settings screen');
  await page.keyboard.press('Escape');
  await page.getByRole('navigation').getByRole('button', { name: 'Personal' }).click();
  await page.locator('li button.body').first().click();
  await page.getByRole('dialog', { name: 'Fix item' }).getByRole('button', { name: 'Save' }).waitFor();
  await checkNames('the edit sheet');
  await page.keyboard.press('Escape');

  // Start-up speed with everything cached, on a CPU slowed 4x to stand in for a phone.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const times = [];
  for (let i = 0; i < 5; i++) {
    await page.reload();
    await page.getByLabel('Capture', { exact: true }).waitFor();
    times.push(await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(Math.round(performance.now()))))));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  times.sort((a, b) => a - b);
  console.log(`start-up (offline, cached, CPU 4x slower): box on screen after ${times[2]} ms median (${times.join(', ')}); the app itself reported "${ready}" unthrottled`);
  if (times[2] > 2500) throw new Error(`start-up too slow: ${times[2]} ms`);

  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);

  // A browser that refuses to store data: say so, and never pretend a capture was saved.
  const locked = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const lockedPage = await locked.newPage();
  await locked.setOffline(false);
  await lockedPage.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('storage is disabled', 'SecurityError');
    };
  });
  await context.setOffline(false);
  await lockedPage.goto(url);
  await lockedPage.getByRole('alert').getByText(/will not let Unforget store data/).waitFor({ timeout: 10000 });
  const lockedBox = lockedPage.getByLabel('Capture', { exact: true });
  await lockedBox.fill('mag niet verdwijnen');
  await lockedBox.press('Enter');
  await lockedPage.waitForFunction(() => document.querySelector('form input')?.value === 'mag niet verdwijnen', null, { timeout: 5000 });
  await locked.close();
  console.log('e2e offline: ok');
} catch (err) {
  failed = true;
  console.error('e2e offline: FAILED\n', err);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
process.exit(failed ? 1 : 0);
