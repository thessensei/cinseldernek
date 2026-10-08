// server.js — SPEKTRUM backend (Express + node:sqlite)
// Çalıştırma: npm install && npm start   → http://localhost:3000
try { process.loadEnvFile(); } catch { /* .env yoksa sorun değil */ }

const express = require('express');
const crypto = require('node:crypto');
const { registerRoutes, requireAuth, COOKIE_NAME } = require('./auth');
const { apiRoutes } = require('./api');
const { chatRoutes } = require('./chat');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // canlı önizleme / reverse proxy arkasında doğru IP & secure çerez
app.disable('x-powered-by');

app.use(express.json({ limit: '200kb' }));

// Basit çerez ayrıştırıcı (ekstra bağımlılık yok)
app.use((req, res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq > -1) req.cookies[decodeURIComponent(part.slice(0, eq).trim())] = decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  next();
});

// Güvenlik başlıkları
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'"
  );
  next();
});

// Kimlik doğrulama rotaları (public)
registerRoutes(app);

// API (oturum ister) + yazma hız sınırı
let writeLimiter = (req, res, next) => next();
{
  const hits = new Map();
  writeLimiter = (req, res, next) => {
    const ip = req.ip || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    const now = Date.now();
    const rec = hits.get(ip) || { count: 0, reset: now + 60_000 };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + 60_000; }
    if (++rec.count > 60) return res.status(429).json({ ok: false, error: 'Çok fazla istek. Biraz bekle.' });
    hits.set(ip, rec);
    next();
  };
}
apiRoutes(app, requireAuth, writeLimiter);
chatRoutes(app, requireAuth, writeLimiter);

// Bilinmeyen API uçları JSON dönsün
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Bulunamadı.' }));

// Kaynak kod / veritabanı dosyaları asla servis edilmesin
app.use((req, res, next) => {
  if (/\.(js|json|db|db-wal|db-shm|env)$/i.test(req.path)) return res.status(403).end();
  next();
});

// Statik dosyalar (index.html, app.html ...)
app.use(express.static(__dirname));

// Genel hata yakalayıcı
app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ ok: false, error: 'Sunucuda beklenmeyen bir hata oluştu.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏳️‍🌈 SPEKTRUM çalışıyor → http://localhost:${PORT}`);
  if (!process.env.GOOGLE_CLIENT_ID) console.log('ℹ️  Google girişi pasif (GOOGLE_CLIENT_ID/SECRET tanımla). E-posta + parola akışı aktif.');
});
