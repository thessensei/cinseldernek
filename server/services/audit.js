import { nowIso } from '../lib/text.js';

/** Yönetici/moderatör eylemlerini denetim kaydına yazar. */
export function audit(db, { actorId = null, action, targetType = null, targetId = null, details = {} }) {
  db.prepare(
    'INSERT INTO audit_logs (actor_id, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(actorId, action, targetType, targetId == null ? null : String(targetId), JSON.stringify(details), nowIso());
}
