import { renderMarkdown } from '../lib/markdown.js';
import { LIKE_ESCAPE, likePattern, slugify } from '../lib/text.js';
import { uniqueSlug } from '../db/index.js';

export const POST_SELECT = `
  SELECT p.id, p.slug, p.title, p.excerpt, p.body_md, p.cover_url, p.tags, p.status, p.views, p.author_id,
         p.published_at, p.created_at, p.updated_at,
         u.username AS author_username, u.display_name AS author_display_name, u.avatar_color AS author_avatar_color
  FROM posts p
  LEFT JOIN users u ON u.id = p.author_id`;

export function normalizeTags(list = []) {
  const tags = new Set();
  for (const raw of list) {
    const tag = String(raw).trim().toLocaleLowerCase('tr-TR').replace(/[,\s]+/g, '-').slice(0, 30);
    if (tag) tags.add(tag);
  }
  return [...tags].slice(0, 10);
}

// Etiketler ",a,b," biçiminde saklanır; böylece instr() ile tam eşleşme yapılır.
export const tagsToStorage = (tags) => (tags.length ? `,${tags.join(',')},` : '');
export const tagsFromStorage = (stored) => (stored ? stored.split(',').filter(Boolean) : []);

export const postSlug = (db, title, requested, excludeId = null) =>
  uniqueSlug(db, 'posts', slugify(requested || title), excludeId);

/**
 * mode: 'list' (özet), 'public' (HTML dahil), 'admin' (düzenleme için ham markdown dahil)
 */
export function serializePost(row, mode = 'list') {
  const post = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    coverUrl: row.cover_url,
    tags: tagsFromStorage(row.tags),
    status: row.status,
    views: row.views,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: row.author_id
      ? {
          id: row.author_id,
          username: row.author_username,
          displayName: row.author_display_name ?? 'Silinmiş üye',
          avatarColor: row.author_avatar_color,
        }
      : null,
  };
  if (mode === 'public') post.html = renderMarkdown(row.body_md);
  if (mode === 'admin') {
    post.bodyMd = row.body_md;
    post.html = renderMarkdown(row.body_md);
  }
  return post;
}

export const getPostRow = (db, id) => db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(id) ?? null;
export const getPublishedPostRow = (db, slug) =>
  db.prepare(`${POST_SELECT} WHERE p.slug = ? AND p.status = 'published'`).get(slug) ?? null;

export function listPublishedPosts(db, { q, tag, page, limit }) {
  const where = ["p.status = 'published'"];
  const params = { limit, offset: (page - 1) * limit };
  if (q) {
    where.push(`(p.title LIKE @q ${LIKE_ESCAPE} OR p.excerpt LIKE @q ${LIKE_ESCAPE})`);
    params.q = likePattern(q);
  }
  if (tag) {
    where.push('instr(p.tags, @tagNeedle) > 0');
    params.tagNeedle = `,${tag},`;
  }
  const clause = where.join(' AND ');
  const rows = db
    .prepare(`${POST_SELECT} WHERE ${clause} ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC LIMIT @limit OFFSET @offset`)
    .all(params);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${clause}`).get(params).n;
  return { posts: rows.map((row) => serializePost(row, 'list')), total, page, limit };
}

export function listAllTags(db) {
  const counts = new Map();
  for (const row of db.prepare("SELECT tags FROM posts WHERE status = 'published'").all()) {
    for (const tag of tagsFromStorage(row.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'tr'));
}

export function listComments(db, postId) {
  return db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.author_id, u.username, u.display_name, u.avatar_color
       FROM post_comments c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.post_id = ? AND c.deleted_at IS NULL
       ORDER BY c.id ASC`,
    )
    .all(postId)
    .map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      authorId: row.author_id,
      author: row.author_id && row.username
        ? { id: row.author_id, username: row.username, displayName: row.display_name, avatarColor: row.avatar_color }
        : null,
    }));
}
