import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/text.js';
import { audit } from './audit.js';
import { countActiveAdmins, getUserRow, toAdminUser, toPublicUser, toSelfUser } from './users.js';

/** Kullanıcının durumunu (aktif / yasaklı) değiştirir. Moderatörler yalnızca standart üyeleri yasaklayabilir. */
export function applyUserStatus(ctx, actor, targetId, { status, reason = null }) {
  const { db, hub, presence } = ctx;
  const target = getUserRow(db, targetId);
  if (!target || target.status === 'deleted') throw notFound('Kullanıcı');
  if (target.id === actor.id) throw badRequest('Kendi hesabınızın durumunu değiştiremezsiniz.');
  if (actor.role !== 'admin' && target.role !== 'user') {
    throw forbidden('Moderatörler yalnızca standart üyelerin durumunu değiştirebilir.');
  }
  if (status === 'banned' && target.role === 'admin' && countActiveAdmins(db) <= 1) {
    throw badRequest('Sistemdeki son yönetici yasaklanamaz.');
  }
  const banReason = status === 'banned' ? reason : null;
  if (target.status === status && (target.ban_reason ?? null) === banReason) return toAdminUser(target, presence);

  db.prepare('UPDATE users SET status = ?, ban_reason = ?, updated_at = ? WHERE id = ?').run(
    status,
    banReason,
    nowIso(),
    target.id,
  );
  if (status === 'banned') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    hub.revokeUser(target.id, { event: { type: 'auth:revoked', reason: 'banned' }, code: 4003 });
  }
  audit(db, {
    actorId: actor.id,
    action: status === 'banned' ? 'user.banned' : 'user.unbanned',
    targetType: 'user',
    targetId: target.id,
    details: { reason: banReason },
  });
  const updated = getUserRow(db, target.id);
  hub.broadcast({ type: 'user:updated', user: toPublicUser(updated, presence) });
  return toAdminUser(updated, presence, { includeEmail: actor.role === 'admin' });
}

/** Kullanıcı rolünü değiştirir (yalnızca yönetici). */
export function applyUserRole(ctx, actor, targetId, role) {
  const { db, hub, presence } = ctx;
  const target = getUserRow(db, targetId);
  if (!target || target.status === 'deleted') throw notFound('Kullanıcı');
  if (target.id === actor.id) throw badRequest('Kendi rolünüzü değiştiremezsiniz.');
  if (target.role === 'admin' && role !== 'admin' && countActiveAdmins(db) <= 1) {
    throw badRequest('Sistemdeki son yönetici görevden alınamaz.');
  }
  if (target.role === role) return toAdminUser(target, presence, { includeEmail: true });
  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, nowIso(), target.id);
  audit(db, {
    actorId: actor.id,
    action: 'user.role_changed',
    targetType: 'user',
    targetId: target.id,
    details: { from: target.role, to: role },
  });
  const updated = getUserRow(db, target.id);
  hub.sendToUser(target.id, { type: 'user:updated', user: toSelfUser(updated) });
  hub.broadcast({ type: 'user:updated', user: toPublicUser(updated, presence) });
  return toAdminUser(updated, presence, { includeEmail: true });
}
