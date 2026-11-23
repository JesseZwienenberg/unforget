// Smoke test against the deployed Worker. Run by the deploy workflow after every deploy.
const base = process.env.WORKER_URL?.replace(/\/$/, '');
const token = process.env.APP_TOKEN;
const expectVersion = process.env.EXPECT_VERSION;
const origin = process.env.APP_ORIGIN ?? 'https://jessezwienenberg.github.io';

if (!base || !token) {
  console.error('::error::smoke test needs WORKER_URL and APP_TOKEN');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

// A fresh deploy (and a brand-new workers.dev address) can take a minute to be served.
let health = null;
let lastError = '';
for (let attempt = 1; attempt <= 30; attempt++) {
  try {
    const res = await fetch(`${base}/health`, { headers: { origin } });
    const body = await res.json();
    if (res.ok && (!expectVersion || body.version === expectVersion)) {
      health = { res, body };
      break;
    }
    lastError = `status ${res.status}, version ${body.version}`;
  } catch (err) {
    lastError = String(err.cause ?? err);
  }
  await sleep(5000);
}

if (!health) {
  check('health responds with the new version', false, lastError);
} else {
  const { res, body } = health;
  check('health responds with the new version', true, body.version);
  check('database reachable and migrated', body.ok === true && body.db === 'ok', `db=${body.db} schema=${body.schema}`);
  check('app token is configured on the Worker', body.tokenConfigured === true);
  check('CORS allows the app origin', res.headers.get('access-control-allow-origin') === origin);

  const evil = await fetch(`${base}/health`, { headers: { origin: 'https://example.com' } });
  check('CORS refuses other origins', evil.headers.get('access-control-allow-origin') === null);

  const anon = await fetch(`${base}/v1/ping`);
  check('requests without a token get 401', anon.status === 401, `status ${anon.status}`);

  const authed = await fetch(`${base}/v1/ping`, { headers: { authorization: `Bearer ${token}` } });
  check('requests with the token get 200', authed.status === 200, `status ${authed.status}`);
}

if (failures.length) {
  console.error(`::error::Smoke test failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('Smoke test passed.');
