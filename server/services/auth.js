import { createHash, randomBytes } from 'node:crypto';
import { nowIso } from '../lib/text.js';
import { getUserRow } from './users.js';

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/** Yeni oturum oluşturur. Ham belirteç yalnızca çerezde tutulur; veritabanında özeti saklanır. */
export function createSession(db, userId, { ttlMs, userAgent = '', ip = '' }) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlMs);
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(tokenHash, userId, createdAt.toISOString(), expiresAt.toISOString(), String(userAgent).slice(0, 255), String(ip).slice(0, 64));
  return { token, tokenHash, expiresAt };
}

export function findSessionUser(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, nowIso());
  if (!row) return null;
  const user = getUserRow(db, row.user_id);
  if (!user || user.status !== 'active') return null;
  return { user, tokenHash };
}

export function cleanupExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}
