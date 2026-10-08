import { Router } from 'express';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { hashPassword, generatePassword } from '../lib/passwords.js';
import { renderMarkdown } from '../lib/markdown.js';
import { schemas, ROLES } from '../lib/schemas.js';
import { LIKE_ESCAPE, likePattern, nowIso, slugify } from '../lib/text.js';
import { parse, parseId } from '../lib/validate.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getMessageRow, emitMessageUpdate, serializeRoom, softDeleteMessage } from '../services/chat.js';
import { POST_SELECT, getPostRow, normalizeTags, postSlug, serializePost, tagsToStorage } from '../services/blog.js';
import { serializeReport } from '../services/reports.js';
import { applyUserRole, applyUserStatus } from '../services/moderation.js';
import { getSettings, publicSettings, setSetting } from '../services/settings.js';
import { USER_COLS, getUserRow, toAdminUser } from '../services/users.js';
import { uniqueSlug } from '../db/index.js';

const parseJson = (text, fallback) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};

export function adminRoutes(ctx) {
  const { db, presence } = ctx;
  const router = Router();
  const staff = requireRole('moderator', 'admin');
  const adminOnly = requireRole('admin');
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  const isAdmin = (req) => req.user.role === 'admin';

  /* ------------------------------- Özet ------------------------------- */

  router.get('/stats', staff, (req, res) => {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const since = startOfDay.toISOString();
    res.json({
      users: {
        total: count("SELECT COUNT(*) AS n FROM users WHERE status != 'deleted'"),
        active: count("SELECT COUNT(*) AS n FROM users WHERE status = 'active'"),
        banned: count("SELECT COUNT(*) AS n FROM users WHERE status = 'banned'"),
        staff: count("SELECT COUNT(*) AS n FROM users WHERE role IN ('moderator', 'admin') AND status = 'active'"),
        newToday: count("SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND status != 'deleted'", since),
      },
      onlineNow: presence.onlineIds().length,
      messages: {
        total: count('SELECT COUNT(*) AS n FROM messages'),
        today: count('SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?', since),
        direct: count('SELECT COUNT(*) AS n FROM messages WHERE conversation_id IS NOT NULL'),
      },
      rooms: count('SELECT COUNT(*) AS n FROM rooms'),
      posts: {
        published: count("SELECT COUNT(*) AS n FROM posts WHERE status = 'published'"),
        draft: count("SELECT COUNT(*) AS n FROM posts WHERE status = 'draft'"),
      },
      reports: { open: count("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'") },
      recentReports: db
        .prepare("SELECT * FROM reports WHERE status = 'open' ORDER BY id DESC LIMIT 5")
        .all()
        .map((row) => serializeReport(db, row, presence)),
      recentUsers: db
        .prepare(`SELECT ${USER_COLS} FROM users WHERE status != 'deleted' ORDER BY id DESC LIMIT 6`)
        .all()
        .map((row) => toAdminUser(row, presence)),
    });
  });

  /* ----------------------------- Kullanıcılar ----------------------------- */

  router.get('/users', staff, (req, res) => {
    const q = parse(schemas.pageQuery, req.query);
    const where = [];
    const params = { limit: q.limit, offset: (q.page - 1) * q.limit };
    if (q.q) {
      const term = q.q.trim();
      const emailClause = isAdmin(req) ? ` OR email_lower LIKE @raw ${LIKE_ESCAPE}` : '';
      where.push(
        `(username_lower LIKE @lower ${LIKE_ESCAPE} OR display_name LIKE @raw ${LIKE_ESCAPE}${emailClause})`,
      );
      params.lower = likePattern(term.toLocaleLowerCase('tr-TR'));
      params.raw = likePattern(term);
    }
    if (ROLES.includes(q.role)) {
      where.push('role = @role');
      params.role = q.role;
    }
    if (['active', 'banned', 'deleted'].includes(q.status)) {
      where.push('status = @status');
      params.status = q.status;
    } else {
      where.push("status != 'deleted'");
    }
    const clause = `WHERE ${where.join(' AND ')}`;
    const rows = db
      .prepare(`SELECT ${USER_COLS} FROM users ${clause} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
      .all(params);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM users ${clause}`).get(params).n;
    res.json({
      users: rows.map((row) => toAdminUser(row, presence, { includeEmail: isAdmin(req) })),
      total,
      page: q.page,
      limit: q.limit,
    });
  });

  router.get('/users/:id', staff, (req, res) => {
    const id = parseId(req.params.id);
    const row = getUserRow(db, id);
    if (!row || row.status === 'deleted') throw notFound('Kullanıcı');
    res.json({
      user: toAdminUser(row, presence, { includeEmail: isAdmin(req) }),
      stats: {
        roomMessages: count('SELECT COUNT(*) AS n FROM messages WHERE author_id = ? AND room_id IS NOT NULL', id),
        directMessages: count('SELECT COUNT(*) AS n FROM messages WHERE author_id = ? AND conversation_id IS NOT NULL', id),
        reportsAgainst: count('SELECT COUNT(*) AS n FROM reports WHERE reported_user_id = ?', id),
        reportsFiled: count('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?', id),
        posts: count('SELECT COUNT(*) AS n FROM posts WHERE author_id = ?', id),
      },
      recentReports: db
        .prepare('SELECT id, reason, status, created_at AS createdAt FROM reports WHERE reported_user_id = ? ORDER BY id DESC LIMIT 10')
        .all(id),
    });
  });

  router.patch('/users/:id', staff, (req, res) => {
    const id = parseId(req.params.id);
    const input = parse(schemas.adminUserPatch, req.body);
    if (input.role !== undefined && !isAdmin(req)) throw forbidden('Rol değişikliği yalnızca yöneticiler içindir.');
    let user = null;
    if (input.role !== undefined) user = applyUserRole(ctx, req.user, id, input.role);
    if (input.status !== undefined) {
      user = applyUserStatus(ctx, req.user, id, {
        status: input.status,
        reason: input.status === 'banned' ? input.banReason || null : null,
      });
    }
    if (!user) {
      const row = getUserRow(db, id);
      if (!row || row.status === 'deleted') throw notFound('Kullanıcı');
      user = toAdminUser(row, presence, { includeEmail: isAdmin(req) });
    }
    res.json({ user });
  });

  router.post('/users/:id/reset-password', adminOnly, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === req.user.id) throw badRequest('Kendi parolanızı Profil sayfasından değiştirebilirsiniz.');
    const target = getUserRow(db, id);
    if (!target || target.status === 'deleted') throw notFound('Kullanıcı');
    const temporaryPassword = generatePassword(14);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      await hashPassword(temporaryPassword),
      nowIso(),
      id,
    );
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    ctx.hub.revokeUser(id, { event: { type: 'auth:revoked', reason: 'password_reset' } });
    audit(db, { actorId: req.user.id, action: 'user.password_reset', targetType: 'user', targetId: id });
    res.json({ temporaryPassword });
  });

  /* --------------------------------- Blog --------------------------------- */

  router.get('/posts', staff, (req, res) => {
    const q = parse(schemas.pageQuery, req.query);
    const where = [];
    const params = { limit: q.limit, offset: (q.page - 1) * q.limit };
    if (q.q) {
      where.push(`p.title LIKE @q ${LIKE_ESCAPE}`);
      params.q = likePattern(q.q.trim());
    }
    if (q.status === 'draft' || q.status === 'published') {
      where.push('p.status = @status');
      params.status = q.status;
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db
      .prepare(`${POST_SELECT} ${clause} ORDER BY p.id DESC LIMIT @limit OFFSET @offset`)
      .all(params);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM posts p ${clause}`).get(params).n;
    res.json({ posts: rows.map((row) => serializePost(row, 'list')), total, page: q.page, limit: q.limit });
  });

  router.get('/posts/:id', staff, (req, res) => {
    const row = getPostRow(db, parseId(req.params.id));
    if (!row) throw notFound('Yazı');
    res.json({ post: serializePost(row, 'admin') });
  });

  router.post('/posts', staff, (req, res) => {
    const input = parse(schemas.postInput, req.body);
    const now = nowIso();
    const slug = postSlug(db, input.title, input.slug);
    const info = db
      .prepare(
        `INSERT INTO posts (slug, title, excerpt, body_md, cover_url, tags, status, author_id, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        slug,
        input.title,
        input.excerpt,
        input.bodyMd,
        input.coverUrl || null,
        tagsToStorage(normalizeTags(input.tags)),
        input.status,
        req.user.id,
        input.status === 'published' ? now : null,
        now,
        now,
      );
    audit(db, { actorId: req.user.id, action: 'post.created', targetType: 'post', targetId: info.lastInsertRowid, details: { slug } });
    res.status(201).json({ post: serializePost(getPostRow(db, info.lastInsertRowid), 'admin') });
  });

  router.put('/posts/:id', staff, (req, res) => {
    const id = parseId(req.params.id);
    const existing = getPostRow(db, id);
    if (!existing) throw notFound('Yazı');
    const input = parse(schemas.postInput, req.body);
    const slug = postSlug(db, input.title, input.slug || existing.slug, id);
    const now = nowIso();
    const publishedAt = input.status === 'published' ? existing.published_at || now : existing.published_at;
    db.prepare(
      `UPDATE posts SET slug = ?, title = ?, excerpt = ?, body_md = ?, cover_url = ?, tags = ?, status = ?,
         published_at = ?, updated_at = ? WHERE id = ?`,
    ).run(
      slug,
      input.title,
      input.excerpt,
      input.bodyMd,
      input.coverUrl || null,
      tagsToStorage(normalizeTags(input.tags)),
      input.status,
      publishedAt,
      now,
      id,
    );
    audit(db, { actorId: req.user.id, action: 'post.updated', targetType: 'post', targetId: id, details: { status: input.status } });
    res.json({ post: serializePost(getPostRow(db, id), 'admin') });
  });

  router.delete('/posts/:id', staff, (req, res) => {
    const id = parseId(req.params.id);
    const existing = getPostRow(db, id);
    if (!existing) throw notFound('Yazı');
    db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    audit(db, { actorId: req.user.id, action: 'post.deleted', targetType: 'post', targetId: id, details: { title: existing.title } });
    res.status(204).end();
  });

  router.post('/markdown', staff, (req, res) => {
    const { body } = parse(schemas.markdown, req.body);
    res.json({ html: renderMarkdown(body) });
  });

  /* --------------------------------- Odalar --------------------------------- */

  router.get('/rooms', adminOnly, (req, res) => {
    const rows = db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) AS message_count
         FROM rooms r ORDER BY r.sort_order, r.id`,
      )
      .all();
    res.json({ rooms: rows.map((row) => serializeRoom(row, { messageCount: row.message_count })) });
  });

  router.post('/rooms', adminOnly, (req, res) => {
    const input = parse(schemas.roomInput, req.body);
    const slug = uniqueSlug(db, 'rooms', slugify(input.slug || input.name));
    const info = db
      .prepare(
        `INSERT INTO rooms (slug, name, description, is_readonly, is_archived, sort_order, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(slug, input.name, input.description, input.isReadonly ? 1 : 0, input.isArchived ? 1 : 0, input.sortOrder, req.user.id, nowIso());
    audit(db, { actorId: req.user.id, action: 'room.created', targetType: 'room', targetId: info.lastInsertRowid, details: { slug } });
    ctx.hub.broadcast({ type: 'rooms:changed' });
    res.status(201).json({ room: serializeRoom(db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid)) });
  });

  router.patch('/rooms/:id', adminOnly, (req, res) => {
    const id = parseId(req.params.id);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room) throw notFound('Oda');
    const input = parse(schemas.roomPatch, req.body);
    const slug = input.slug !== undefined && input.slug !== '' ? uniqueSlug(db, 'rooms', slugify(input.slug), id) : room.slug;
    db.prepare(
      `UPDATE rooms SET slug = ?, name = ?, description = ?, is_readonly = ?, is_archived = ?, sort_order = ? WHERE id = ?`,
    ).run(
      slug,
      input.name ?? room.name,
      input.description ?? room.description,
      input.isReadonly === undefined ? room.is_readonly : input.isReadonly ? 1 : 0,
      input.isArchived === undefined ? room.is_archived : input.isArchived ? 1 : 0,
      input.sortOrder ?? room.sort_order,
      id,
    );
    audit(db, { actorId: req.user.id, action: 'room.updated', targetType: 'room', targetId: id, details: input });
    ctx.hub.broadcast({ type: 'rooms:changed' });
    res.json({ room: serializeRoom(db.prepare('SELECT * FROM rooms WHERE id = ?').get(id)) });
  });

  router.delete('/rooms/:id', adminOnly, (req, res) => {
    const id = parseId(req.params.id);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room) throw notFound('Oda');
    db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    audit(db, { actorId: req.user.id, action: 'room.deleted', targetType: 'room', targetId: id, details: { name: room.name } });
    ctx.hub.broadcast({ type: 'rooms:changed' });
    res.status(204).end();
  });

  /* ------------------------------- Şikayetler ------------------------------- */

  router.get('/reports', staff, (req, res) => {
    const q = parse(schemas.pageQuery, req.query);
    const status = ['open', 'resolved', 'dismissed'].includes(q.status) ? q.status : null;
    const clause = status ? 'WHERE status = @status' : '';
    const params = { limit: q.limit, offset: (q.page - 1) * q.limit };
    if (status) params.status = status;
    const rows = db.prepare(`SELECT * FROM reports ${clause} ORDER BY id DESC LIMIT @limit OFFSET @offset`).all(params);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM reports ${clause}`).get(status ? { status } : {}).n;
    res.json({
      reports: rows.map((row) => serializeReport(db, row, presence)),
      total,
      page: q.page,
      limit: q.limit,
    });
  });

  router.post('/reports/:id/resolve', staff, (req, res) => {
    const id = parseId(req.params.id);
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    if (!report) throw notFound('Şikayet');
    if (report.status !== 'open') throw conflict('Bu şikayet zaten sonuçlandırılmış.');
    const input = parse(schemas.resolveReport, req.body);
    if (input.outcome === 'dismissed' && (input.deleteMessage || input.banUser)) {
      throw badRequest('Reddedilen bir şikayette işlem uygulanamaz.');
    }
    const actions = [];

    if (input.deleteMessage) {
      if (!report.message_id) throw badRequest('Bu şikayet bir mesaja bağlı değil.');
      const message = getMessageRow(db, report.message_id);
      if (message && message.deleted_at == null) {
        softDeleteMessage(db, message.id, req.user.id);
        emitMessageUpdate(ctx, message.id);
      }
      actions.push('mesaj_silindi');
    }

    if (input.banUser) {
      const targetId =
        report.reported_user_id ?? (report.message_id ? getMessageRow(db, report.message_id)?.author_id : null);
      if (!targetId) throw badRequest('Yasaklanacak kullanıcı bulunamadı.');
      applyUserStatus(ctx, req.user, targetId, { status: 'banned', reason: `Şikayet #${id}: ${report.reason}` });
      actions.push('kullanici_yasaklandi');
    }

    db.prepare('UPDATE reports SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').run(
      input.outcome === 'dismissed' ? 'dismissed' : 'resolved',
      JSON.stringify({ actions, note: input.note || '' }),
      req.user.id,
      nowIso(),
      id,
    );
    audit(db, {
      actorId: req.user.id,
      action: 'report.resolved',
      targetType: 'report',
      targetId: id,
      details: { outcome: input.outcome, actions },
    });
    ctx.hub.sendToStaff({ type: 'reports:changed' });
    res.json({ report: serializeReport(db, db.prepare('SELECT * FROM reports WHERE id = ?').get(id), presence) });
  });

  /* --------------------------- Denetim ve ayarlar --------------------------- */

  router.get('/audit', adminOnly, (req, res) => {
    const q = parse(schemas.pageQuery, req.query);
    const params = { limit: q.limit, offset: (q.page - 1) * q.limit };
    const rows = db
      .prepare(
        `SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.created_at, a.actor_id, u.username AS actor_username
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.id DESC LIMIT @limit OFFSET @offset`,
      )
      .all(params);
    res.json({
      logs: rows.map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: parseJson(row.details, {}),
        createdAt: row.created_at,
        actor: row.actor_id ? { id: row.actor_id, username: row.actor_username } : null,
      })),
      total: count('SELECT COUNT(*) AS n FROM audit_logs'),
      page: q.page,
      limit: q.limit,
    });
  });

  router.get('/settings', adminOnly, (req, res) => {
    res.json({ settings: publicSettings(db), raw: getSettings(db) });
  });

  router.put('/settings', adminOnly, (req, res) => {
    const input = parse(schemas.settingsPatch, req.body);
    if (input.announcement !== undefined) setSetting(db, 'announcement', input.announcement);
    if (input.registrationOpen !== undefined) setSetting(db, 'registration_open', input.registrationOpen ? '1' : '0');
    audit(db, { actorId: req.user.id, action: 'settings.updated', details: input });
    const settings = publicSettings(db);
    ctx.hub.broadcast({ type: 'settings:changed', settings });
    res.json({ settings });
  });

  return router;
}
