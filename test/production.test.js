const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '..');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('production defaults disable demo login and the seeded expert credential', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spektrum-prod-'));
  const port = await createPort();
  const origin = `http://127.0.0.1:${port}`;
  let logs = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      DATABASE_PATH: path.join(tempDir, 'production.sqlite'),
      COUNSELOR_EMAIL: '',
      COUNSELOR_PASSWORD: '',
      ENABLE_DEMO: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit').catch(() => {});
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(timer);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const deadline = Date.now() + 12_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early.\n${logs}`);
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(700) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for startup. */ }
    await wait(100);
  }
  assert.equal(ready, true, `Server did not become ready.\n${logs}`);

  const configResponse = await fetch(`${origin}/api/public-config`);
  const config = await configResponse.json();
  assert.equal(config.demoEnabled, false);
  assert.equal(config.googleEnabled, false);

  const demoResponse = await fetch(`${origin}/api/auth/demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(demoResponse.status, 404);

  const expertResponse = await fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'psikolog@spektrum.local', password: 'spektrum2026' }),
  });
  assert.equal(expertResponse.status, 401);
});
