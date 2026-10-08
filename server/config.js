import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function toList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTrustProxy(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : value;
}

/**
 * Ortam değişkenlerinden ve (testlerde) overrides nesnesinden yapılandırma üretir.
 * Tüm değerler tek bir yerde toplanır; diğer modüller process.env okumaz.
 */
export function loadConfig(overrides = {}) {
  const env = process.env.NODE_ENV || 'development';
  const sameSiteRaw = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const base = {
    env,
    isProduction: env === 'production',
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 3000,
    dbPath: process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'app.db'),
    publicDir: path.join(ROOT_DIR, 'public'),
    // Ters vekil (nginx, Cloudflare vb.) arkasında çalışılıyorsa TRUST_PROXY=1 gibi bir değer verin.
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    // Farklı bir alan adından API'ye erişiliyorsa virgülle ayrılmış tam origin listesi.
    allowedOrigins: toList(process.env.ALLOWED_ORIGINS),
    sessionTtlMs: 30 * DAY,
    messageMaxLength: 2000,
    cookie: {
      name: 'sid',
      sameSite: ['lax', 'strict', 'none'].includes(sameSiteRaw) ? sameSiteRaw : 'lax',
      secure: toBool(process.env.COOKIE_SECURE, env === 'production'),
    },
    limits: {
      api: { windowMs: MINUTE, max: 1200 },
      login: { windowMs: 15 * MINUTE, max: 10 }, // ip + kimlik başına başarısız deneme
      loginIp: { windowMs: 15 * MINUTE, max: 100 }, // ip başına başarısız deneme
      register: { windowMs: HOUR, max: 20 },
      message: { windowMs: 10 * 1000, max: 8 },
      report: { windowMs: HOUR, max: 20 },
      comment: { windowMs: MINUTE, max: 5 },
      typing: { windowMs: 10 * 1000, max: 30 },
    },
  };

  const config = { ...base, ...overrides };
  config.cookie = { ...base.cookie, ...(overrides.cookie || {}) };
  config.limits = { ...base.limits, ...(overrides.limits || {}) };
  // Tarayıcılar SameSite=None çerezleri yalnızca Secure ile kabul eder.
  if (config.cookie.sameSite === 'none') config.cookie.secure = true;
  return config;
}
