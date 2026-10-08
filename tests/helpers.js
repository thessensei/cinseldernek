import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../server/server.js';

// Testlerde hız sınırları yüksek tutulur; hız sınırı testleri kendi değerlerini verir.
export const GENEROUS_LIMITS = {
  api: { windowMs: 60_000, max: 100_000 },
  login: { windowMs: 60_000, max: 100_000 },
  loginIp: { windowMs: 60_000, max: 100_000 },
  register: { windowMs: 60_000, max: 100_000 },
  message: { windowMs: 60_000, max: 100_000 },
  report: { windowMs: 60_000, max: 100_000 },
  comment: { windowMs: 60_000, max: 100_000 },
  typing: { windowMs: 60_000, max: 100_000 },
};

export async function startServer(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spektrum-test-'));
  const server = createServer({
    dbPath: path.join(dir, 'test.db'),
    port: 0,
    host: '127.0.0.1',
    ...overrides,
    limits: { ...GENEROUS_LIMITS, ...(overrides.limits ?? {}) },
  });
  const { port } = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  return {
    server,
    base,
    db: server.db,
    async stop() {
      await server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Çerez taşıyan basit HTTP istemcisi. Origin başlığı her zaman sunucu ile aynı kaynaktır. */
export class Client {
  constructor(base) {
    this.base = base;
    this.cookie = null;
    this.user = null;
  }

  async request(method, url, body, headers = {}) {
    const h = { Origin: new URL(this.base).origin, ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    let payload;
    if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect: 'manual' });
    for (const setCookie of res.headers.getSetCookie()) {
      const [pair, ...attrs] = setCookie.split(';');
      const index = pair.indexOf('=');
      if (pair.slice(0, index).trim() !== 'sid') continue;
      const value = pair.slice(index + 1);
      const expired = attrs.some((a) => a.trim().toLowerCase() === 'max-age=0');
      this.cookie = expired || value === '' ? null : `sid=${value}`;
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: res.status, body: data, headers: res.headers };
  }

  get(url, headers) {
    return this.request('GET', url, undefined, headers);
  }
  post(url, body = {}, headers) {
    return this.request('POST', url, body, headers);
  }
  patch(url, body = {}) {
    return this.request('PATCH', url, body);
  }
  put(url, body = {}) {
    return this.request('PUT', url, body);
  }
  del(url) {
    return this.request('DELETE', url);
  }

  async register(username, password = 'Parola123!', extra = {}) {
    const res = await this.post('/api/auth/register', {
      username,
      email: `${username}@test.dev`,
      password,
      ...extra,
    });
    if (res.status === 201) this.user = res.body.user;
    return res;
  }

  async login(identifier, password = 'Parola123!') {
    const res = await this.post('/api/auth/login', { identifier, password });
    if (res.status === 200) this.user = res.body.user;
    return res;
  }
}

export async function makeUser(env, username, extra = {}) {
  const client = new Client(env.base);
  const res = await client.register(username, 'Parola123!', extra);
  if (res.status !== 201) throw new Error(`Kayıt başarısız: ${JSON.stringify(res.body)}`);
  return client;
}

export function promote(env, client, role) {
  env.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, client.user.id);
}

/** WebSocket bağlantısı; gelen olayları biriktirir ve beklemeyi destekler. */
export function openSocket(client, { origin, cookie } = {}) {
  const url = client.base.replace(/^http/, 'ws') + '/ws';
  const headers = { Origin: origin ?? new URL(client.base).origin };
  const cookieHeader = cookie ?? client.cookie;
  if (cookieHeader) headers.Cookie = cookieHeader;
  const ws = new WebSocket(url, { headers });
  const events = [];
  const waiters = new Set();
  const closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));

  ws.on('message', (raw) => {
    events.push(JSON.parse(raw.toString()));
    for (const waiter of [...waiters]) waiter();
  });

  const socket = {
    ws,
    events,
    closed,
    waitFor(predicate, timeout = 3000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const found = events.find(predicate);
          if (found) {
            cleanup();
            resolve(found);
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Beklenen WebSocket olayı zamanında gelmedi'));
        }, timeout);
        const cleanup = () => {
          clearTimeout(timer);
          waiters.delete(check);
        };
        waiters.add(check);
        check();
      });
    },
    close() {
      ws.close();
    },
  };

  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(socket));
    ws.once('error', reject);
  });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
