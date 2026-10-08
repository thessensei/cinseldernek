import { Router } from 'express';
import { badRequest, notFound } from '../lib/errors.js';
import { LIKE_ESCAPE, likePattern, nowIso } from '../lib/text.js';
import { parseId, parse } from '../lib/validate.js';
import { schemas } from '../lib/schemas.js';
import { USER_COLS, getUserRow, isBlocking, toPublicUser } from '../services/users.js';

export function userRoutes(ctx) {
  const { db, presence } = ctx;
  const router = Router();

  router.get('/', (req, res) => {
    const { q, limit } = parse(schemas.userSearch, req.query);
    const term = (q || '').trim();
    let rows;
    if (term) {
      rows = db
        .prepare(
          `SELECT ${USER_COLS} FROM users
           WHERE status = 'active' AND id != @me
             AND (username_lower LIKE @lower ${LIKE_ESCAPE} OR display_name LIKE @raw ${LIKE_ESCAPE})
           ORDER BY username_lower LIMIT @limit`,
        )
        .all({
          me: req.user.id,
          lower: likePattern(term.toLocaleLowerCase('tr-TR')),
          raw: likePattern(term),
          limit,
        });
    } else {
      rows = db
        .prepare(
          `SELECT ${USER_COLS} FROM users WHERE status = 'active' AND id != @me
           ORDER BY last_seen_at IS NULL, last_seen_at DESC, username_lower LIMIT @limit`,
        )
        .all({ me: req.user.id, limit });
    }
    res.json({ users: rows.map((row) => toPublicUser(row, presence)) });
  });

  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const row = getUserRow(db, id);
    if (!row || row.status !== 'active') throw notFound('Kullanıcı');
    res.json({
      user: {
        ...toPublicUser(row, presence),
        isSelf: id === req.user.id,
        blockedByMe: isBlocking(db, req.user.id, id),
      },
    });
  });

  router.post('/:id/block', (req, res) => {
    const id = parseId(req.params.id);
    if (id === req.user.id) throw badRequest('Kendinizi engelleyemezsiniz.');
    const target = getUserRow(db, id);
    if (!target || target.status !== 'active') throw notFound('Kullanıcı');
    db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
      req.user.id,
      id,
      nowIso(),
    );
    res.status(204).end();
  });

  router.delete('/:id/block', (req, res) => {
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, parseId(req.params.id));
    res.status(204).end();
  });

  return router;
}
