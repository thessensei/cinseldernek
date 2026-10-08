import { Router } from 'express';
import { HttpError, forbidden } from '../lib/errors.js';
import { clearSessionCookie } from '../lib/http.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { schemas } from '../lib/schemas.js';
import { nowIso } from '../lib/text.js';
import { parse } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { anonymizeUser, getUserRow, toPublicUser, toSelfUser } from '../services/users.js';

export function meRoutes(ctx) {
  const { db, config, presence } = ctx;
  const router = Router();

  router.patch('/', (req, res) => {
    const input = parse(schemas.profile, req.body);
    const columns = { displayName: 'display_name', bio: 'bio', avatarColor: 'avatar_color', helpArea: 'help_area' };
    const sets = [];
    const params = { id: req.user.id, now: nowIso() };
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] !== undefined) {
        sets.push(`${column} = @${key}`);
        params[key] = input[key] ?? null;
      }
    }
    if (sets.length) {
      db.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = @now WHERE id = @id`).run(params);
    }
    const user = getUserRow(db, req.user.id);
    ctx.hub.broadcast({ type: 'user:updated', user: toPublicUser(user, presence) });
    res.json({ user: toSelfUser(user) });
  });

  router.post('/password', async (req, res) => {
    const input = parse(schemas.changePassword, req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
      throw new HttpError(400, 'invalid_password', 'Mevcut parolanız hatalı.');
    }
    const hash = await hashPassword(input.newPassword);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, nowIso(), req.user.id);
    // Diğer tüm oturumlar kapatılır; bu oturum açık kalır.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash);
    ctx.hub.revokeUser(req.user.id, { exceptHash: req.sessionHash });
    res.status(204).end();
  });

  router.get('/blocks', (req, res) => {
    const rows = db
      .prepare(
        `SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id
         WHERE b.blocker_id = ? AND u.status = 'active' ORDER BY b.created_at DESC`,
      )
      .all(req.user.id);
    res.json({ users: rows.map((row) => toPublicUser(row, presence)) });
  });

  router.post('/delete', async (req, res) => {
    if (req.user.role === 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get().n <= 1) {
      throw forbidden('Sistemdeki son yönetici hesabı silinemez. Önce başka bir yönetici atayın.');
    }
    const input = parse(schemas.confirmPassword, req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await verifyPassword(input.password, row.password_hash))) {
      throw new HttpError(400, 'invalid_password', 'Parolanız hatalı.');
    }
    anonymizeUser(db, req.user.id);
    audit(db, { actorId: req.user.id, action: 'user.self_deleted', targetType: 'user', targetId: req.user.id });
    ctx.hub.revokeUser(req.user.id, { event: { type: 'auth:revoked', reason: 'deleted' } });
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  return router;
}
