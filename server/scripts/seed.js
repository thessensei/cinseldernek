/**
 * Başlangıç verilerini yükler (idempotent: mevcut kayıt varsa tekrar eklemez).
 *   npm run seed                 → odalar ve örnek blog yazıları
 *   npm run seed -- --demo       → ek olarak demo hesaplar, mesajlar ve DM (yalnızca geliştirme için!)
 */
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { hashPassword } from '../lib/passwords.js';
import { normalizeEmail, normalizeUsername, nowIso } from '../lib/text.js';
import { tagsToStorage, normalizeTags, postSlug } from '../services/blog.js';
import { DEMO_DM, DEMO_MESSAGES, DEFAULT_ROOMS, DEMO_PASSWORD, DEMO_USERS, SAMPLE_POSTS } from '../seed-data.js';
import { AVATAR_COLORS } from '../lib/schemas.js';
import { findOrCreateConversation } from '../services/chat.js';

const demo = process.argv.includes('--demo') || process.env.SEED_DEMO === '1';
const config = loadConfig();
const db = openDatabase(config.dbPath);
const now = nowIso();
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

const rooms = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
if (rooms === 0) {
  const insert = db.prepare(
    'INSERT INTO rooms (slug, name, description, is_readonly, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const room of DEFAULT_ROOMS) {
    insert.run(room.slug, room.name, room.description, room.isReadonly ? 1 : 0, room.sortOrder, now);
  }
  console.log(`✓ ${DEFAULT_ROOMS.length} sohbet odası eklendi.`);
}

const posts = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
if (posts === 0) {
  const insert = db.prepare(
    `INSERT INTO posts (slug, title, excerpt, body_md, tags, status, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
  );
  SAMPLE_POSTS.forEach((post, index) => {
    const stamp = new Date(Date.now() - (SAMPLE_POSTS.length - index) * 86_400_000).toISOString();
    insert.run(
      postSlug(db, post.title, null),
      post.title,
      post.excerpt,
      post.bodyMd,
      tagsToStorage(normalizeTags(post.tags)),
      stamp,
      stamp,
      stamp,
    );
  });
  console.log(`✓ ${SAMPLE_POSTS.length} örnek blog yazısı eklendi.`);
}

if (demo) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const ids = new Map();
  for (const user of DEMO_USERS) {
    const row = db.prepare('SELECT id FROM users WHERE username_lower = ?').get(normalizeUsername(user.username));
    if (row) {
      ids.set(user.username, row.id);
      continue;
    }
    const info = db
      .prepare(
        `INSERT INTO users (username, username_lower, email, email_lower, password_hash, display_name, bio, avatar_color, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        user.username,
        normalizeUsername(user.username),
        normalizeEmail(user.email),
        normalizeEmail(user.email),
        passwordHash,
        user.displayName,
        user.bio,
        AVATAR_COLORS[ids.size % AVATAR_COLORS.length],
        user.role,
        now,
        now,
      );
    ids.set(user.username, Number(info.lastInsertRowid));
  }
  console.log(`✓ Demo hesaplar hazır (parola: ${DEMO_PASSWORD}). Canlı ortamda silin veya parolalarını değiştirin!`);

  const messageCount = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  if (messageCount === 0) {
    const roomIds = new Map(db.prepare('SELECT slug, id FROM rooms').all().map((r) => [r.slug, r.id]));
    const insertMessage = db.prepare('INSERT INTO messages (room_id, author_id, body, created_at) VALUES (?, ?, ?, ?)');
    DEMO_MESSAGES.forEach((message, index) => {
      insertMessage.run(roomIds.get(message.room), ids.get(message.user), message.body, minutesAgo(60 - index * 5));
    });
    const { conv } = findOrCreateConversation(db, ids.get('ayla'), ids.get('deniz'));
    const insertDm = db.prepare('INSERT INTO messages (conversation_id, author_id, body, created_at) VALUES (?, ?, ?, ?)');
    DEMO_DM.forEach((message, index) => {
      insertDm.run(conv.id, ids.get(message.from), message.body, minutesAgo(30 - index * 4));
    });
    console.log('✓ Demo mesajları ve özel konuşma eklendi.');
  }
}

if (!demo && !posts && !rooms) console.log('Yeni bir şey eklenmedi; veritabanı zaten dolu.');
console.log(`Veritabanı: ${config.dbPath}`);
db.close();
