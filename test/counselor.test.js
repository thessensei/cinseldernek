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

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit').catch(() => {});
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited;
  clearTimeout(force);
}

test('expert support queue is role-protected and status changes notify the member', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spektrum-counselor-'));
  const port = await createPort();
  const origin = `http://127.0.0.1:${port}`;
  let logs = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      DATABASE_PATH: path.join(tempDir, 'dev.sqlite'),
      COUNSELOR_EMAIL: '',
      COUNSELOR_PASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  t.after(async () => {
    await stopChild(child);
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

  const send = async (route, { method = 'GET', body, cookie } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${origin}${route}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, data: await response.json().catch(() => null) };
  };

  const expertLogin = await send('/api/auth/login', {
    method: 'POST', body: { email: 'psikolog@spektrum.local', password: 'spektrum2026' },
  });
  assert.equal(expertLogin.response.status, 200);
  assert.equal(expertLogin.data.user.role, 'counselor');
  const expertCookie = (expertLogin.response.headers.get('set-cookie') || '').split(';')[0];

  const memberLogin = await send('/api/auth/register', {
    method: 'POST', body: { email: `member-${Date.now()}@example.org`, password: 'safe-password-123', name: 'Topluluk Üyesi' },
  });
  assert.equal(memberLogin.response.status, 200);
  const memberCookie = (memberLogin.response.headers.get('set-cookie') || '').split(';')[0];

  const created = await send('/api/support-requests', {
    method: 'POST', cookie: memberCookie,
    body: { type: 'hukuk', subject: 'Yönlendirme talebi', message: 'Bir uzmana nasıl ulaşabileceğimi öğrenmek istiyorum.' },
  });
  assert.equal(created.response.status, 200);
  assert.equal((await send('/api/counselor/support-requests', { cookie: memberCookie })).response.status, 403);

  const queue = await send('/api/counselor/support-requests', { cookie: expertCookie });
  assert.equal(queue.response.status, 200);
  const request = queue.data.requests.find((item) => item.id === created.data.id);
  assert.ok(request);
  assert.equal(request.rumuz, 'Topluluk Üyesi');
  assert.equal('email' in request, false);

  const update = await send(`/api/counselor/support-requests/${request.id}/status`, {
    method: 'PATCH', cookie: expertCookie, body: { status: 'inceleniyor' },
  });
  assert.equal(update.response.status, 200);
  const memberRequests = await send('/api/support-requests', { cookie: memberCookie });
  assert.equal(memberRequests.data.requests[0].status, 'inceleniyor');
  const memberNotifications = await send('/api/notifications', { cookie: memberCookie });
  assert.ok(memberNotifications.data.notifications.some((item) => item.type === 'request_status'));
});
