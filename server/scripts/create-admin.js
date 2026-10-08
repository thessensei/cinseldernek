/**
 * Yönetici hesabı oluşturur veya mevcut hesabı yönetici yapar.
 *   ADMIN_EMAIL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run create-admin
 * Parola komut satırında değil, ortam değişkeni olarak verilir (shell geçmişine düşmesin diye).
 */
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { AVATAR_COLORS, USERNAME_RE } from '../lib/schemas.js';
import { hashPassword } from '../lib/passwords.js';
import { normalizeEmail, normalizeUsername, nowIso } from '../lib/text.js';

const { ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
const displayName = process.env.ADMIN_DISPLAY_NAME || ADMIN_USERNAME || 'Yönetici';

function fail(message) {
  console.error(`Hata: ${message}`);
  console.error('Kullanım: ADMIN_EMAIL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run create-admin');
  process.exit(1);
}

if (!ADMIN_EMAIL || !ADMIN_USERNAME || !ADMIN_PASSWORD) fail('ADMIN_EMAIL, ADMIN_USERNAME ve ADMIN_PASSWORD zorunludur.');
if (!USERNAME_RE.test(ADMIN_USERNAME)) fail('Rumuz 3-24 karakter olmalı; harf, rakam, _, . ve - içerebilir.');
if (ADMIN_PASSWORD.length < 8) fail('Parola en az 8 karakter olmalı.');

const config = loadConfig();
const db = openDatabase(config.dbPath);
const email = normalizeEmail(ADMIN_EMAIL);
const usernameLower = normalizeUsername(ADMIN_USERNAME);
const passwordHash = await hashPassword(ADMIN_PASSWORD);
const now = nowIso();

const existing = db
  .prepare('SELECT id, username FROM users WHERE email_lower = ? OR username_lower = ?')
  .get(email, usernameLower);

if (existing) {
  db.prepare(
    "UPDATE users SET role = 'admin', status = 'active', ban_reason = NULL, password_hash = ?, updated_at = ? WHERE id = ?",
  ).run(passwordHash, now, existing.id);
  console.log(`Mevcut hesap (${existing.username}) yönetici yapıldı ve parolası güncellendi.`);
} else {
  const color = AVATAR_COLORS[0];
  db.prepare(
    `INSERT INTO users (username, username_lower, email, email_lower, password_hash, display_name, avatar_color, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', 'active', ?, ?)`,
  ).run(ADMIN_USERNAME.trim(), usernameLower, email, email, passwordHash, displayName, color, now, now);
  console.log(`Yönetici hesabı oluşturuldu: ${ADMIN_USERNAME}`);
}
db.close();
