import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { RateLimiter } from './lib/rate-limit.js';
import { createHub } from './realtime/hub.js';
import { Presence } from './realtime/presence.js';
import { cleanupExpiredSessions } from './services/auth.js';

function createLimiters(config) {
  const make = (name) => new RateLimiter({ name, ...config.limits[name] });
  return {
    api: make('api'),
    login: make('login'),
    loginIp: make('loginIp'),
    register: make('register'),
    message: make('message'),
    report: make('report'),
    comment: make('comment'),
    typing: make('typing'),
  };
}

/**
 * Uygulamayı (HTTP + WebSocket + veritabanı) birleştirir.
 * Testler overrides ile geçici veritabanı ve boş port kullanabilir.
 */
export function createServer(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDatabase(config.dbPath);
  cleanupExpiredSessions(db);

  const presence = new Presence();
  const limiters = createLimiters(config);
  const ctx = { config, db, presence, limiters, hub: null };
  const app = createApp(ctx);
  const httpServer = http.createServer(app);
  ctx.hub = createHub({ httpServer, db, config, presence, limiters });

  const sweeper = setInterval(() => cleanupExpiredSessions(db), 60 * 60 * 1000);
  sweeper.unref();

  let closed = false;
  return {
    config,
    db,
    ctx,
    app,
    httpServer,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        httpServer.once('error', onError);
        httpServer.listen(config.port, config.host, () => {
          httpServer.off('error', onError);
          const { port } = httpServer.address();
          resolve({ port, host: config.host });
        });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(sweeper);
      await ctx.hub.close();
      httpServer.closeAllConnections?.();
      await new Promise((resolve) => httpServer.close(() => resolve()));
      db.close();
    },
  };
}
