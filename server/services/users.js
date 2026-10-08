import { AVATAR_COLORS } from '../lib/schemas.js';
import { conflict } from '../lib/errors.js';
import { hashPassword } from '../lib/passwords.js';
import { nowIso, normalizeEmail, normalizeUsername } from '../lib/text.js';

// Parola özeti hiçbir zaman bu sütun listesine dahil edilmez.
export const USER_COLS =
  'id, username, username_lower, email, display_name, bio, avatar_color, help_area, role, status, ban_reason, last_seen_at, created_at, updated_at';

export const getUserRow = (db, id) => db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) ?? null;

export const findUserConflict = (db, username, email) =>
  db
    .prepare('SELECT username_lower, email_lower FROM users WHERE username_lower = ? OR email_lower = ? LIMIT 1')
    .get(normalizeUsername(username), normalizeEmail(email));

export const countActiveAdmins = (db) =>
  db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get().n;

/** Giriş için parola özetiyle birlikte kullanıcıyı bulur (yalnızca auth akışında kullanılır). */
export function findLoginRow(db, identifier) {
  const sql = 'SELECT id, password_hash, status, ban_reason FROM users WHERE ';
  if (identifier.includes('@')) return db.prepare(`${sql}email_lower = ?`).get(normalizeEmail(identifier)) ?? null;
  return db.prepare(`${sql}username_lower = ?`).get(normalizeUsername(identifier)) ?? null;
}

export async function createUser(db, { username, email, password, displayName, helpArea }) {
  const now = nowIso();
  const passwordHash = await hashPassword(password);
  const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  try {
    const info = db
      .prepare(
        `INSERT INTO users (username, username_lower, email, email_lower, password_hash, display_name, help_area,
           avatar_color, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user', 'active', ?, ?)`,
      )
      .run(
        username.trim(),
        normalizeUsername(username),
        email,
        normalizeEmail(email),
        passwordHash,
        displayName || username.trim(),
        helpArea ?? null,
        avatarColor,
        now,
        now,
      );
    return getUserRow(db, info.lastInsertRowid);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw conflict('Bu rumuz veya e-posta zaten kullanılıyor.');
    throw error;
  }
}

/** Herkese açık kullanıcı görünümü. E-posta, durum ve destek alanı içermez. */
export function toPublicUser(row, presence) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarColor: row.avatar_color,
    role: row.role,
    createdAt: row.created_at,
    online: presence ? presence.isOnline(row.id) : false,
  };
}

/** Kullanıcının kendi profili. */
export function toSelfUser(row) {
  return {
    ...toPublicUser(row, null),
    email: row.email,
    helpArea: row.help_area,
    status: row.status,
    banReason: row.ban_reason,
  };
}

/** Yönetim paneli görünümü. E-posta yalnızca yöneticilere gösterilir (includeEmail). */
export function toAdminUser(row, presence, { includeEmail = false } = {}) {
  return {
    ...toPublicUser(row, presence),
    ...(includeEmail ? { email: row.email } : {}),
    helpArea: row.help_area,
    status: row.status,
    banReason: row.ban_reason,
    lastSeenAt: row.last_seen_at,
  };
}

export function isBlocking(db, blockerId, blockedId) {
  return Boolean(
    db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId),
  );
}

export function isBlockedEitherWay(db, a, b) {
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM blocks WHERE (blocker_id = @a AND blocked_id = @b) OR (blocker_id = @b AND blocked_id = @a) LIMIT 1',
      )
      .get({ a, b }),
  );
}

/**
 * Hesabı silinmiş olarak işaretler: içerik temizlenir, kimlik bilgileri anonimleştirilir.
 * Mesaj kayıtları yapısal bütünlük için korunur ancak içerikleri boşaltılır.
 */
export function anonymizeUser(db, id) {
  const now = nowIso();
  db.transaction(() => {
    db.prepare("UPDATE messages SET body = '', deleted_at = ?, deleted_by = ? WHERE author_id = ? AND deleted_at IS NULL").run(
      now,
      id,
      id,
    );
    db.prepare("UPDATE post_comments SET body = '', deleted_at = ? WHERE author_id = ? AND deleted_at IS NULL").run(now, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').run(id, id);
    db.prepare(
      `UPDATE users SET username = @name, username_lower = @name, email = @email, email_lower = @email,
         password_hash = '!', display_name = 'Silinmiş üye', bio = '', help_area = NULL, status = 'deleted',
         ban_reason = NULL, updated_at = @now
       WHERE id = @id`,
    ).run({ id, name: `silinmis-${id}`, email: `deleted-${id}@deleted.invalid`, now });
  })();
}
