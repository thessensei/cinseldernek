// SPEKTRUM HTTP server. Only files inside /public are exposed to browsers.
try { process.loadEnvFile(); } catch { /* .env is optional */ }

const express = require('express');
const path = require('node:path');
const { registerRoutes, requireAuth } = require('./auth');
const { apiRoutes } = require('./api');
const { chatRoutes } = require('./chat');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, 'public');

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb', strict: true }));

// Parse cookies defensively: a malformed cookie must not take down the request.
app.use((req, res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 1) continue;
      try {
        const key = decodeURIComponent(part.slice(0, eq).trim());
        const value = decodeURIComponent(part.slice(eq + 1).trim());
        if (key) req.cookies[key] = value;
      } catch { /* Ignore malformed cookie fragments. */ }
    }
  }
  next();
});

// Browser state-changing requests must originate from this site. This keeps the
// cross-site preview cookie mode from becoming a CSRF bypass.
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.path.startsWith('/api/')) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // Non-browser clients may authenticate through the session cookie directly.
  try {
    const originUrl = new URL(origin);
    const forwardedHosts = String(req.get('x-forwarded-host') || '').split(',').map((host) => host.trim()).filter(Boolean);
    const hostCandidates = new Set([req.get('host'), req.hostname, ...forwardedHosts]);
    const isPreviewOrigin = /\\.e2b\\.app$/i.test(originUrl.hostname);
    const expectedProtocol = IS_PROD || req.secure || isPreviewOrigin ? 'https:' : 'http:';
    const hostMatches = hostCandidates.has(originUrl.host) || hostCandidates.has(originUrl.hostname);
    if (!hostMatches || originUrl.protocol !== expectedProtocol) return res.status(403).json({ ok: false, error: 'İstek kaynağı doğrulanamadı.' });
  } catch {
    return res.status(403).json({ ok: false, error: 'İstek kaynağı doğrulanamadı.' });
  }
  next();
});

// Security headers; the preview exception allows the Arena iframe to render the app.
app.use((req, res, next) => {
  const host = req.hostname || req.get('host') || '';
  const isArenaPreview = /\.e2b\.app(?::\d+)?$/i.test(host);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isArenaPreview) res.removeHeader('X-Frame-Options');
  else res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
    `frame-ancestors ${isArenaPreview ? "'self' https:" : "'none'"}`
  );
  next();
});

registerRoutes(app);

// Public liveness checks are intentionally registered before authenticated API routes.
app.get('/healthz', (req, res) => res.json({ ok: true, service: 'spektrum' }));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'spektrum' }));

function createWriteLimiter({ windowMs = 60_000, max = 60 } = {}) {
  const hits = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits) if (record.reset <= now) hits.delete(key);
  }, Math.min(windowMs, 60_000));
  cleanup.unref();

  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    const now = Date.now();
    let record = hits.get(ip);
    if (!record || record.reset <= now) {
      record = { count: 0, reset: now + windowMs };
      hits.set(ip, record);
    }
    record.count += 1;
    if (record.count > max) return res.status(429).json({ ok: false, error: 'Çok fazla istek. Biraz bekleyip yeniden dene.' });
    next();
  };
}

const writeLimiter = createWriteLimiter();
apiRoutes(app, requireAuth, writeLimiter);
chatRoutes(app, requireAuth, writeLimiter);

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'API uç noktası bulunamadı.' }));

// The server-side source, database, and configuration files are outside this directory.
app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  etag: true,
  fallthrough: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use((req, res) => res.status(404).send('Sayfa bulunamadı.'));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'İstek çok büyük.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'Geçersiz JSON isteği.' });
  console.error('[server]', err);
  res.status(500).json({ ok: false, error: 'Sunucuda beklenmeyen bir hata oluştu.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏳️‍🌈 SPEKTRUM çalışıyor → http://0.0.0.0:${PORT}`);
  if (!process.env.GOOGLE_CLIENT_ID) console.log('ℹ️ Google girişi yapılandırılmamış; e-posta ve parola ile giriş kullanılabilir.');
  if (process.env.NODE_ENV === 'production' && !process.env.COUNSELOR_EMAIL) {
    console.log('ℹ️ Uzman hesabı yok; güvenlik için varsayılan demo uzman hesabı etkinleştirilmedi.');
  }
});
