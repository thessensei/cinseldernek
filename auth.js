// auth.js — kayıt / giriş / çıkış / Google OAuth / oturum ara katmanı
const crypto = require('node:crypto');
const db = require('./db');

const COOKIE_NAME = 'spk_sid';
const STATE_COOKIE = 'spk_gstate';
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------- PAROLA (scrypt) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt:') || String(password).length > 128) return false;
  const [, salt, hash] = stored.split(':');
  if (!salt || !/^[a-f0-9]{128}$/i.test(hash || '')) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const real = Buffer.from(hash, 'hex');
  return candidate.length === real.length && crypto.timingSafeEqual(candidate, real);
}

// ---------- ÇEREZLER ----------
function cookiePolicy(req) {
  const host = req?.hostname || req?.get?.('host') || '';
  const isPreview = /\.e2b\.app(?::\d+)?$/i.test(host);
  const secure = IS_PROD || Boolean(req?.secure) || isPreview;
  // Arena renders previews in a cross-site iframe; SameSite=None is required there.
  return { secure, sameSite: isPreview ? 'none' : 'lax', partitioned: isPreview };
}
function setSessionCookie(res, token, expires, req) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    ...cookiePolicy(req),
    expires: new Date(expires),
    path: '/',
  });
}
function clearSessionCookie(res) { res.clearCookie(COOKIE_NAME, { path: '/' }); }

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, rumuz: u.rumuz,
    provider: u.provider, supportArea: u.support_area, role: u.role || 'member', createdAt: u.created_at,
  };
}

// Oturum zorunlu middleware
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const user = db.getSessionUser(token);
  if (!user) return res.status(401).json({ ok: false, error: 'Oturum gerekli. Lütfen giriş yap.' });
  req.user = user;
  next();
}

// ---------- BASİT HIZ SINIRI (bellek içi; test/loopback muaf) ----------
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { for (const [k, v] of hits) if (v.reset < Date.now()) hits.delete(k); }, 60000).unref();
  return (req, res, next) => {
    const ip = req.ip || '';
    const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (loopback) return next(); // yerel geliştirme/test muaf
    const now = Date.now();
    const rec = hits.get(ip) || { count: 0, reset: now + windowMs };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
    rec.count++;
    hits.set(ip, rec);
    if (rec.count > max) return res.status(429).json({ ok: false, error: 'Çok fazla deneme. Lütfen biraz sonra tekrar dene.' });
    next();
  };
}

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());
const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);

// ---------- ROUTES ----------
function registerRoutes(app) {
  const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
  const registerLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

  // KAYIT — e-posta + parola
  app.post('/api/auth/register', registerLimiter, (req, res) => {
    try {
      const { email, password, name, supportArea } = req.body || {};
      const nm = clean(name, 40);
      const em = clean(email, 120);
      if (!nm || nm.length < 2) return res.status(400).json({ ok: false, error: 'İsim/rumuz en az 2 karakter olmalı.' });
      if (!emailOk(em)) return res.status(400).json({ ok: false, error: 'Geçerli bir e-posta gir.' });
      if (!password || String(password).length < 8 || String(password).length > 128)
        return res.status(400).json({ ok: false, error: 'Parola 8–128 karakter arasında olmalı.' });
      if (db.getUserByEmail(em)) return res.status(409).json({ ok: false, error: 'Bu e-postayla bir hesap zaten var. Giriş yapmayı dene.' });

      const user = db.createUser({
        email: em,
        passwordHash: hashPassword(String(password)),
        name: nm, rumuz: nm,
        supportArea: new Set(['psikolojik', 'hukuk', 'topluluk', 'barinma', 'gonullu', 'diger']).has(clean(supportArea, 30))
          ? clean(supportArea, 30) : null,
      });
      const { token, expires } = db.createSession(user.id);
      setSessionCookie(res, token, expires, req);
      res.json({ ok: true, user: publicUser(user) });
    } catch (err) {
      console.error('[register]', err);
      res.status(500).json({ ok: false, error: 'Kayıt sırasında bir sorun oluştu.' });
    }
  });

  // GİRİŞ — e-posta + parola
  app.post('/api/auth/login', loginLimiter, (req, res) => {
    try {
      const { email, password } = req.body || {};
      const user = email ? db.getUserByEmail(clean(email, 120)) : null;
      if (!user || !verifyPassword(String(password || ''), user.password_hash))
        return res.status(401).json({ ok: false, error: 'E-posta veya parola hatalı.' });
      const { token, expires } = db.createSession(user.id);
      setSessionCookie(res, token, expires, req);
      res.json({ ok: true, user: publicUser(user) });
    } catch (err) {
      console.error('[login]', err);
      res.status(500).json({ ok: false, error: 'Giriş sırasında bir sorun oluştu.' });
    }
  });

  // DEMO — only enabled by default outside production.
  const demoEnabled = () => process.env.NODE_ENV !== 'production' || process.env.ENABLE_DEMO === 'true';
  app.post('/api/auth/demo', loginLimiter, (req, res) => {
    if (!demoEnabled()) return res.status(404).json({ ok: false, error: 'Demo hesabı kapalı.' });
    let user = db.getUserByEmail('demo@spektrum.local');
    if (!user) {
      user = db.createUser({
        email: 'demo@spektrum.local',
        passwordHash: null,
        name: 'Demo Kullanıcı', rumuz: 'Gökkuşağı Misafiri',
        provider: 'local', supportArea: 'topluluk',
      });
    }
    const { token, expires } = db.createSession(user.id);
    setSessionCookie(res, token, expires, req);
    res.json({ ok: true, user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) db.deleteSession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ ok: true, user: publicUser(req.user) }));

  // ---------- GOOGLE OAUTH 2.0 ----------
  const G_ID = process.env.GOOGLE_CLIENT_ID;
  const G_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const googleConfigured = () => Boolean(G_ID && G_SECRET);
  app.get('/api/public-config', (req, res) => res.json({ ok: true, googleEnabled: googleConfigured(), demoEnabled: demoEnabled() }));

  const googleUnavailablePage = (res) => res.redirect('/?gerror=unavailable');

  app.get('/auth/google', (req, res) => {
    if (!googleConfigured()) return googleUnavailablePage(res);
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, state, { httpOnly: true, ...cookiePolicy(req), maxAge: 10 * 60 * 1000, path: '/' });
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: G_ID, redirect_uri: redirectUri, response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get('/auth/google/callback', async (req, res) => {
    try {
      if (!googleConfigured()) return googleUnavailablePage(res);
      const { code, state, error } = req.query;
      if (error || !code) return res.redirect('/?gerror=cancelled');
      if (!state || state !== req.cookies?.[STATE_COOKIE]) return res.redirect('/?gerror=state');
      res.clearCookie(STATE_COOKIE, { path: '/' });

      const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: G_ID, client_secret: G_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) throw new Error('token exchange failed: ' + tokenRes.status);
      const { access_token } = await tokenRes.json();

      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!infoRes.ok) throw new Error('userinfo failed: ' + infoRes.status);
      const profile = await infoRes.json(); // { sub, email, name, email_verified, picture }

      let user = db.getUserByProvider('google', profile.sub);
      if (!user && profile.email_verified && profile.email) {
        user = db.getUserByEmail(profile.email);
        if (user) db.linkGoogleToUser(user.id, profile.sub); // mevcut parola hesabını Google'a bağla
      }
      if (!user) {
        const nm = clean(profile.name, 40) || 'Gökkusağı Dostu';
        user = db.createUser({ email: profile.email, name: nm, rumuz: nm, provider: 'google', providerId: profile.sub });
      }
      const { token, expires } = db.createSession(user.id);
      setSessionCookie(res, token, expires, req);
      res.redirect('/app.html');
    } catch (err) {
      console.error('[google/callback]', err);
      res.redirect('/?gerror=failed');
    }
  });

  return { requireAuth, COOKIE_NAME };
}

module.exports = { registerRoutes, requireAuth, COOKIE_NAME };
