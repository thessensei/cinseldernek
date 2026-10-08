import { HttpError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function securityHeaders(config) {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.cookie.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  };
}

const firstHeaderValue = (value) => (value ? String(value).split(',')[0].trim().toLowerCase() : '');

/**
 * İstek aynı kaynaktan mı geliyor? (CSRF ve Cross-Site WebSocket Hijacking'e karşı.)
 * Tarayıcının Sec-Fetch-Site başlığı öncelikli; yoksa Origin, Host ile karşılaştırılır.
 */
export function isRequestSameOrigin(req, config) {
  const headers = req.headers;
  const fetchSite = headers['sec-fetch-site'];
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';
  const origin = headers.origin;
  if (!origin) return true; // Tarayıcı dışı istemciler (curl, testler) için; CSRF yalnızca tarayıcıdan mümkündür.
  if (config.allowedOrigins.includes(origin)) return true;
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const hosts = [firstHeaderValue(headers['x-forwarded-host']), firstHeaderValue(headers.host)];
  return hosts.includes(originHost);
}

export function originGuard(config) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!isRequestSameOrigin(req, config)) {
      return next(new HttpError(403, 'csrf', 'İstek kaynağı doğrulanamadı.'));
    }
    const contentLength = req.headers['content-length'];
    const hasBody = (contentLength !== undefined && contentLength !== '0') || req.headers['transfer-encoding'];
    if (hasBody && !req.is('application/json')) {
      return next(new HttpError(415, 'unsupported_media_type', 'İstekler JSON olarak gönderilmelidir.'));
    }
    return next();
  };
}
