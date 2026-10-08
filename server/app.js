import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { HttpError } from './lib/errors.js';
import { sessionMiddleware, requireAuth, requireRole } from './middleware/auth.js';
import { originGuard, securityHeaders } from './middleware/security.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { blogRoutes } from './routes/blog.js';
import { dmRoutes } from './routes/dms.js';
import { meRoutes } from './routes/me.js';
import { messageRoutes } from './routes/messages.js';
import { reportRoutes } from './routes/reports.js';
import { roomRoutes } from './routes/rooms.js';
import { userRoutes } from './routes/users.js';
import { publicSettings } from './services/settings.js';

/** SPA için: dosya uzantısı olmayan GET isteklerini index.html'e yönlendirir. */
function spaFallback(publicDir) {
  const index = path.join(publicDir, 'index.html');
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/assets/') || path.extname(req.path)) {
      return next(new HttpError(404, 'not_found', 'Dosya bulunamadı.'));
    }
    if (!fs.existsSync(index)) return next(new HttpError(404, 'not_found', 'Arayüz bulunamadı.'));
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(index, (error) => {
      if (error) next(error);
    });
  };
}

function errorHandler() {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'bad_json', message: 'Geçersiz JSON gövdesi.' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'too_large', message: 'İstek gövdesi çok büyük.' } });
    }
    console.error('[hata]', req.method, req.originalUrl, err);
    return res.status(500).json({ error: { code: 'internal', message: 'Beklenmeyen bir sunucu hatası oluştu.' } });
  };
}

export function createApp(ctx) {
  const { config, db, limiters } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  // Dinamik API verisi asla önbelleğe alınmaz; koşullu (304) yanıtlar oluşmaması için ETag kapalıdır.
  app.set('etag', false);
  app.use(securityHeaders(config));
  app.use(express.json({ limit: '256kb' }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', limiters.api.middleware());
  app.use(sessionMiddleware(ctx));
  app.use('/api', originGuard(config));

  app.get('/api/settings/public', (req, res) => res.json(publicSettings(db)));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/me', requireAuth, meRoutes(ctx));
  app.use('/api/users', requireAuth, userRoutes(ctx));
  app.use('/api/rooms', requireAuth, roomRoutes(ctx));
  app.use('/api/dms', requireAuth, dmRoutes(ctx));
  app.use('/api/messages', requireAuth, messageRoutes(ctx));
  app.use('/api/reports', requireAuth, reportRoutes(ctx));
  app.use('/api/blog', blogRoutes(ctx));
  app.use('/api/admin', requireAuth, requireRole('moderator', 'admin'), adminRoutes(ctx));
  app.use('/api', (req, res, next) => next(new HttpError(404, 'not_found', 'Uç nokta bulunamadı.')));

  app.use(express.static(config.publicDir, { index: false, maxAge: config.isProduction ? '1h' : 0 }));
  app.use(spaFallback(config.publicDir));
  app.use(errorHandler());
  return app;
}
