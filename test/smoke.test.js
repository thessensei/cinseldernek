const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '..');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForServer(child, origin, output) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early.\n${output()}`);
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(700) });
      if (response.ok) return;
    } catch { /* Wait for startup. */ }
    await wait(100);
  }
  throw new Error(`Server did not become ready.\n${output()}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit').catch(() => {});
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited;
  clearTimeout(force);
}

test('site, authentication, core APIs and privacy controls work end-to-end', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spektrum-smoke-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const dbPath = path.join(tempDir, 'test.sqlite');
  let logs = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATABASE_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  t.after(async () => {
    await stopChild(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  await waitForServer(child, origin, () => logs);

  const send = async (route, { method = 'GET', body, cookie } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${origin}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  };

  const landing = await fetch(origin);
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /SPEKTRUM/);
  assert.equal((await fetch(`${origin}/app.html`)).status, 200);
  assert.equal((await fetch(`${origin}/styles.css`)).status, 200);
  assert.equal((await fetch(`${origin}/app.js`)).status, 200);
  assert.equal((await fetch(`${origin}/server.js`)).status, 404, 'server source must not be exposed');
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);

  const publicConfig = await send('/api/public-config');
  assert.equal(publicConfig.response.status, 200);
  assert.equal(publicConfig.data.demoEnabled, true);
  assert.equal((await send('/api/me')).response.status, 401);
  assert.equal((await fetch(`${origin}/api/me`, { headers: { Cookie: 'spk_sid=%E0%A4%A' } })).status, 401, 'malformed cookies should be ignored safely');
  const malformedJson = await fetch(`${origin}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken',
  });
  assert.equal(malformedJson.status, 400);

  const blockedCrossSiteWrite = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://not-this-site.example' },
    body: JSON.stringify({ email: 'blocked@example.org', password: 'safe-password-123', name: 'Engellenmeli' }),
  });
  assert.equal(blockedCrossSiteWrite.status, 403);

  const email = `smoke-${Date.now()}@example.org`;
  const registration = await send('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'safe-password-123', name: 'Smoke Üye', supportArea: 'topluluk' },
  });
  assert.equal(registration.response.status, 200, JSON.stringify(registration.data));
  assert.equal(registration.data.user.role, 'member');
  const cookie = (registration.response.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^spk_sid=/);

  const me = await send('/api/me', { cookie });
  assert.equal(me.data.user.email, email);
  assert.equal(me.data.user.rumuz, 'Smoke Üye');

  const createdPost = await send('/api/posts', {
    method: 'POST', cookie, body: { content: 'Duman testi paylaşımı', category: 'genel' },
  });
  assert.equal(createdPost.response.status, 200);
  const posts = await send('/api/posts?category=tumu', { cookie });
  const post = posts.data.posts.find((item) => item.id === createdPost.data.id);
  assert.ok(post);
  assert.equal((await send(`/api/posts/${post.id}/react`, { method: 'POST', cookie, body: {} })).data.supported, true);
  assert.equal((await send(`/api/posts/${post.id}/comments`, { method: 'POST', cookie, body: { content: 'Yanındayım.' } })).response.status, 200);
  assert.equal((await send(`/api/posts/${post.id}/comments`, { cookie })).data.comments.length, 1);

  assert.equal((await send('/api/support-requests', {
    method: 'POST', cookie, body: { type: 'topluluk', subject: 'Duman testi', message: 'Bu, uçtan uca test için oluşturuldu.' },
  })).response.status, 200);
  assert.equal((await send('/api/support-requests', { cookie })).data.requests.length, 1);

  const pack = { summary: 'Test özeti', links: [{ label: 'Örnek', url: 'https://example.org' }], approved: true, closed: false };
  assert.equal((await send('/api/support-pack', { method: 'POST', cookie, body: pack })).response.status, 200);
  assert.equal((await send('/api/support-pack/approved-links', { cookie })).response.status, 200);
  assert.equal((await send('/api/support-pack', {
    method: 'POST', cookie, body: { ...pack, approved: false },
  })).response.status, 200);
  assert.equal((await send('/api/support-pack/approved-links', { cookie })).response.status, 403, 'sharing consent must be revocable');

  const global = await send('/api/chat/global', { cookie });
  assert.equal(global.response.status, 200);
  const message = await send(`/api/chat/${global.data.conversationId}/messages`, {
    method: 'POST', cookie, body: { content: 'Sohbet duman testi' },
  });
  assert.equal(message.response.status, 200);
  const conversation = await send(`/api/chat/${global.data.conversationId}/messages`, { cookie });
  assert.ok(conversation.data.messages.some((item) => item.content === 'Sohbet duman testi'));
  assert.ok((await send('/api/resources', { cookie })).data.resources.length > 0);

  assert.equal((await send('/api/auth/logout', { method: 'POST', cookie, body: {} })).response.status, 200);
  assert.equal((await send('/api/me', { cookie })).response.status, 401);
});
