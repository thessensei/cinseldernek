import { Router } from 'express';
import { forbidden, notFound, tooMany } from '../lib/errors.js';
import { schemas } from '../lib/schemas.js';
import { nowIso } from '../lib/text.js';
import { parse, parseId } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { isMod } from '../services/chat.js';
import { getPublishedPostRow, listAllTags, listComments, listPublishedPosts, serializePost } from '../services/blog.js';

export function blogRoutes(ctx) {
  const { db, limiters } = ctx;
  const router = Router();

  router.get('/posts', (req, res) => {
    const query = parse(schemas.blogQuery, req.query);
    res.json(listPublishedPosts(db, query));
  });

  router.get('/tags', (req, res) => {
    res.json({ tags: listAllTags(db) });
  });

  router.get('/posts/:slug', (req, res) => {
    const row = getPublishedPostRow(db, req.params.slug);
    if (!row) throw notFound('Yazı');
    db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(row.id);
    res.json({ post: serializePost({ ...row, views: row.views + 1 }, 'public') });
  });

  router.get('/posts/:slug/comments', (req, res) => {
    const row = getPublishedPostRow(db, req.params.slug);
    if (!row) throw notFound('Yazı');
    res.json({ comments: listComments(db, row.id) });
  });

  router.post('/posts/:slug/comments', requireAuth, (req, res) => {
    const row = getPublishedPostRow(db, req.params.slug);
    if (!row) throw notFound('Yazı');
    if (!limiters.comment.hit(`comment:${req.user.id}`)) {
      throw tooMany('Çok sık yorum yapıyorsunuz. Lütfen bir dakika bekleyin.');
    }
    const { body } = parse(schemas.comment, req.body);
    const createdAt = nowIso();
    const info = db
      .prepare('INSERT INTO post_comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(row.id, req.user.id, body, createdAt);
    res.status(201).json({
      comment: {
        id: Number(info.lastInsertRowid),
        body,
        createdAt,
        authorId: req.user.id,
        author: {
          id: req.user.id,
          username: req.user.username,
          displayName: req.user.display_name,
          avatarColor: req.user.avatar_color,
        },
      },
    });
  });

  router.delete('/comments/:id', requireAuth, (req, res) => {
    const comment = db.prepare('SELECT id, author_id, deleted_at FROM post_comments WHERE id = ?').get(parseId(req.params.id));
    if (!comment || comment.deleted_at) throw notFound('Yorum');
    const isAuthor = comment.author_id === req.user.id;
    if (!isAuthor && !isMod(req.user)) throw forbidden();
    db.prepare("UPDATE post_comments SET body = '', deleted_at = ? WHERE id = ?").run(nowIso(), comment.id);
    if (!isAuthor) {
      audit(db, { actorId: req.user.id, action: 'comment.deleted_by_mod', targetType: 'comment', targetId: comment.id });
    }
    res.status(204).end();
  });

  return router;
}
