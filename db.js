// db.js — SQLite (node:sqlite) veritabanı katmanı
// Tek dosyalık veritabanı: data/spektrum.db (git'e eklenmez, .gitignore'da)
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATABASE_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, 'data', 'spektrum.db');
fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

const db = new DatabaseSync(DATABASE_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ---------- ŞEMA ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,                       -- google hesaplarında NULL
  name          TEXT NOT NULL,
  rumuz         TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT 'local',   -- 'local' | 'google'
  provider_id   TEXT,
  support_area  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL DEFAULT 'genel',
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS reactions (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

CREATE TABLE IF NOT EXISTS support_requests (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'beklemede',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_user ON support_requests(user_id);

CREATE TABLE IF NOT EXISTS support_pack (
  user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  approved INTEGER NOT NULL DEFAULT 0,
  links    TEXT NOT NULL DEFAULT '[]',
  summary  TEXT NOT NULL DEFAULT '',
  closed   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resources (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  title    TEXT NOT NULL,
  url      TEXT,
  phone    TEXT,
  category TEXT NOT NULL DEFAULT 'genel',
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notices (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL
);

-- ---------- SOHBET (global + özel mesaj + psikolog destek) ----------
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL DEFAULT 'dm',      -- 'global' | 'dm' | 'support'
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at    TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
`);

// v2 geçiş: kullanıcılara rol alanı ('member' | 'counselor' | 'system')
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'"); } catch { /* sütun zaten var */ }

// v3: bildirim merkezi (zil ikonu)
db.exec(`
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                  -- 'dm' | 'support_msg' | 'comment' | 'react'
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',       -- hedef: sohbet id'si veya paylaşım id'si
  actor_id   TEXT,                           -- tetikleyen kullanıcı (silinirse boş kalır)
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
`);

// ---------- YARDIMCILAR ----------
const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ---------- KULLANICILAR ----------
function createUser({ email, passwordHash = null, name, rumuz, provider = 'local', providerId = null, supportArea = null, role = 'member' }) {
  const id = newId();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, rumuz, provider, provider_id, support_area, role)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, email.toLowerCase().trim(), passwordHash, name, rumuz || name, provider, providerId, supportArea, role);
  return getUserById(id);
}
function getUserById(id)         { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function getUserByEmail(email)   { return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim()); }
function getUserByProvider(p, providerId) {
  return db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get(p, providerId);
}
function linkGoogleToUser(userId, providerId) {
  db.prepare(`UPDATE users SET provider='google', provider_id=?, updated_at=? WHERE id=?`).run(providerId, now(), userId);
}
function updateProfile(userId, { name, rumuz, supportArea }) {
  db.prepare(`UPDATE users SET name=?, rumuz=?, support_area=?, updated_at=? WHERE id=?`)
    .run(name, rumuz, supportArea, now(), userId);
  return getUserById(userId);
}

// ---------- OTURUMLAR ----------
const SESSION_DAYS = 7;
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}
function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`).get(token, now());
  return row || null;
}
function deleteSession(token)   { db.prepare('DELETE FROM sessions WHERE token=?').run(token); }
function cleanExpiredSessions() { db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now()); }

// ---------- TOPLULUK ----------
function createPost(userId, category, content) {
  const id = newId();
  db.prepare('INSERT INTO posts (id, user_id, category, content) VALUES (?, ?, ?, ?)').run(id, userId, category, content);
  return id;
}
function listPosts(category, limit = 50) {
  const where = category && category !== 'tumu' ? 'WHERE p.category = ?' : '';
  const args = category && category !== 'tumu' ? [category, limit] : [limit];
  return db.prepare(`
    SELECT p.id, p.user_id, p.category, p.content, p.created_at,
           u.rumuz, u.role AS author_role,
           (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id) AS supports,
           (SELECT COUNT(*) FROM comments  c WHERE c.post_id = p.id) AS comment_count
    FROM posts p JOIN users u ON u.id = p.user_id
    ${where}
    ORDER BY p.created_at DESC LIMIT ?`).all(...args);
}
function getPost(id) { return db.prepare('SELECT * FROM posts WHERE id=?').get(id); }

function toggleReaction(postId, userId) {
  const existing = db.prepare('SELECT 1 FROM reactions WHERE post_id=? AND user_id=?').get(postId, userId);
  if (existing) {
    db.prepare('DELETE FROM reactions WHERE post_id=? AND user_id=?').run(postId, userId);
    return false;
  }
  db.prepare('INSERT INTO reactions (post_id, user_id) VALUES (?, ?)').run(postId, userId);
  return true;
}
function myReaction(postId, userId) {
  return !!db.prepare('SELECT 1 FROM reactions WHERE post_id=? AND user_id=?').get(postId, userId);
}

function createComment(postId, userId, content) {
  const id = newId();
  db.prepare('INSERT INTO comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, postId, userId, content);
  return id;
}
function listComments(postId) {
  return db.prepare(`
    SELECT c.id, c.user_id, c.content, c.created_at, u.rumuz, u.role AS author_role
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ? ORDER BY c.created_at ASC`).all(postId);
}

// ---------- DESTEK TALEPLERİ ----------
function createRequest(userId, type, subject, message) {
  const id = newId();
  db.prepare('INSERT INTO support_requests (id, user_id, type, subject, message) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, type, subject, message);
  return id;
}
function listMyRequests(userId) {
  return db.prepare('SELECT * FROM support_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(userId);
}
function listAllRequests(limit = 100) {
  return db.prepare(`
    SELECT r.*, u.rumuz FROM support_requests r
    JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC LIMIT ?`).all(limit);
}
function updateRequestStatus(id, status) {
  const result = db.prepare('UPDATE support_requests SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
  if (!result.changes) return null;
  return db.prepare('SELECT * FROM support_requests WHERE id=?').get(id) || null;
}

// ---------- DESTEK PAKETİ ----------
function getSupportPack(userId) {
  return db.prepare('SELECT * FROM support_pack WHERE user_id=?').get(userId) || null;
}
function upsertSupportPack(userId, { approved, links, summary, closed }) {
  const cur = getSupportPack(userId);
  // Consent is revocable: a member may hide their links at any time.
  const approvedVal = approved ? 1 : 0;
  const closedVal = approvedVal && closed ? 1 : 0;
  db.prepare(`INSERT INTO support_pack (user_id, approved, links, summary, closed, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                approved = excluded.approved,
                links    = excluded.links,
                summary  = excluded.summary,
                closed   = excluded.closed,
                updated_at = excluded.updated_at`)
    .run(userId, approvedVal, JSON.stringify(links || []), summary || '', closedVal, now());
  return getSupportPack(userId);
}
function listApprovedLinks() {
  return db.prepare(`
    SELECT u.rumuz, sp.links, sp.summary, sp.updated_at
    FROM support_pack sp JOIN users u ON u.id = sp.user_id
    WHERE sp.approved = 1 AND sp.closed = 0
    ORDER BY sp.updated_at DESC LIMIT 50`).all();
}

// ---------- SOHBET ----------
const GLOBAL_CONV_ID = 'global';

function ensureGlobal() {
  db.prepare(`INSERT OR IGNORE INTO conversations (id, type) VALUES (?, 'global')`).run(GLOBAL_CONV_ID);
}
function getConversation(convId) {
  return db.prepare('SELECT * FROM conversations WHERE id=?').get(convId) || null;
}
function isMember(convId, userId) {
  return !!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, userId);
}
function upsertMembership(convId, userId) {
  db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(convId, userId);
}
// Okunmamış takibi mesaj rowid'si ile yapılır (saniye çakışması imkansız)
try { db.exec('ALTER TABLE conversation_members ADD COLUMN last_read_rowid INTEGER NOT NULL DEFAULT 0'); } catch { /* sütun zaten var */ }
function markRead(convId, userId) {
  db.prepare(`UPDATE conversation_members
              SET last_read_at=datetime('now'),
                  last_read_rowid=(SELECT COALESCE(MAX(rowid),0) FROM messages WHERE conversation_id=?)
              WHERE conversation_id=? AND user_id=?`).run(convId, convId, userId);
}
function addMessage(convId, userId, content) {
  const id = newId();
  db.prepare('INSERT INTO messages (id, conversation_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, convId, userId, content);
  db.prepare(`UPDATE conversations SET last_message_at=datetime('now') WHERE id=?`).run(convId);
  return id;
}
function listMessages(convId, limit = 150) {
  return db.prepare(`
    SELECT m.id, m.content, m.created_at, m.user_id, u.rumuz, u.role AS author_role
    FROM messages m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at ASC, m.rowid ASC LIMIT ?`).all(convId, limit);
}
function unreadCount(convId, userId) {
  return db.prepare(`
    SELECT COUNT(*) AS c FROM messages
    WHERE conversation_id=?
      AND rowid > COALESCE((SELECT last_read_rowid FROM conversation_members WHERE conversation_id=? AND user_id=?), 0)
      AND user_id != ?`).get(convId, convId, userId, userId).c;
}
function lastMessage(convId) {
  return db.prepare(`
    SELECT m.content, m.created_at, u.rumuz FROM messages m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id=? ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1`).get(convId) || null;
}

function createConversation(type) {
  const id = newId();
  db.prepare('INSERT INTO conversations (id, type) VALUES (?, ?)').run(id, type);
  return id;
}
function findDmId(a, b) {
  return db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
    JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
    WHERE c.type = 'dm'`).get(a, b)?.id || null;
}
function getOrCreateDm(a, b) {
  let id = findDmId(a, b);
  if (!id) {
    id = createConversation('dm');
    upsertMembership(id, a); upsertMembership(id, b);
  }
  return id;
}
function getSupportConversationId(userId) {
  return db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
    JOIN users u ON u.id = m.user_id
    WHERE c.type = 'support' AND u.id = ?`).get(userId, userId)?.id || null;
}
function getOrCreateSupportConversation(userId) {
  let id = getSupportConversationId(userId);
  if (!id) {
    id = createConversation('support');
    upsertMembership(id, userId);
  }
  return id;
}
// Kullanıcının özel mesajlar + destek sohbet listesi (global hariç)
function listConversationsFor(userId) {
  const convos = db.prepare(`
    SELECT c.id, c.type FROM conversations c
    JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
    WHERE c.type IN ('dm','support')
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 50`).all(userId);
  const me = getUserById(userId);
  return convos.map((c) => {
    let peer = null;
    if (c.type === 'dm') {
      peer = db.prepare(`
        SELECT u.id, u.rumuz, u.role FROM conversation_members m
        JOIN users u ON u.id = m.user_id
        WHERE m.conversation_id = ? AND m.user_id != ? LIMIT 1`).get(c.id, userId) || null;
    } else {
      // destek sohbeti: üye için karşı taraf = destek ekibi; uzman için = danışan (rolü member olan ilk üye)
      if (me.role === 'counselor') {
        peer = db.prepare(`
          SELECT u.id, u.rumuz, u.role FROM conversation_members m
          JOIN users u ON u.id = m.user_id
          WHERE m.conversation_id = ? AND u.role NOT IN ('counselor','system') LIMIT 1`).get(c.id) || null;
      }
    }
    return { ...c, peer, last: lastMessage(c.id), unread: unreadCount(c.id, userId) };
  });
}
// Uzman gelen kutusu: tüm destek sohbetleri (danışan bilgisi ile)
function listSupportInbox() {
  const convos = db.prepare(`SELECT id FROM conversations WHERE type='support'`).all();
  return convos.map(({ id }) => {
    const owner = db.prepare(`
      SELECT u.id, u.rumuz FROM conversation_members m JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = ? AND u.role NOT IN ('counselor','system') LIMIT 1`).get(id) || null;
    if (!owner) return null;
    return { id, owner, last: lastMessage(id) };
  }).filter(Boolean)
    .sort((a, b) => String(b.last?.created_at || '').localeCompare(String(a.last?.created_at || '')));
}
function systemMessageExists(convId) {
  return !!db.prepare(`
    SELECT 1 FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ? AND u.role = 'system' LIMIT 1`).get(convId);
}
function getSystemUser()      { return getUserByEmail('system@spektrum.local'); }
function getCounselorUser()   { return getUserByEmail('psikolog@spektrum.local'); }

// Sohbet yardımcıları (bildirimler için)
function otherConversationMembers(convId, userId) {
  return db.prepare(`
    SELECT u.id, u.rumuz, u.role FROM conversation_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ? AND m.user_id != ?`).all(convId, userId);
}
function getSupportConversationOwner(convId) {
  return db.prepare(`
    SELECT u.id, u.rumuz, u.role FROM conversation_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ? AND u.role NOT IN ('counselor','system') LIMIT 1`).get(convId) || null;
}
function listCounselors() {
  return db.prepare(`SELECT id, rumuz, role FROM users WHERE role = 'counselor'`).all();
}

// ---------- BİLDİRİMLER ----------
function createNotification({ userId, type, title, body = '', link = '', actorId = null }) {
  if (!userId) return null;
  if (actorId && userId === actorId) return null;      // kendine bildirim yok
  if (!getUserById(userId)) return null;
  const id = newId();
  db.prepare(`INSERT INTO notifications (id, user_id, type, title, body, link, actor_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, type, String(title).slice(0, 120), String(body).slice(0, 200), String(link).slice(0, 200), actorId || null);
  return id;
}
function listNotifications(userId, limit = 30) {
  return db.prepare(`
    SELECT id, type, title, body, link, read_at, created_at
    FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(userId, limit);
}
function unreadNotificationCount(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).c;
}
function markNotificationRead(id, userId) {
  db.prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`).run(now(), id, userId);
}
function markAllNotificationsRead(userId) {
  db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`).run(now(), userId);
}

// ---------- SABİT İÇERİK ----------
function listNotices()   { return db.prepare('SELECT * FROM notices ORDER BY id DESC LIMIT 10').all(); }
function listResources() { return db.prepare('SELECT * FROM resources ORDER BY id ASC').all(); }

// ---------- SEED (ilk kurulum / idempotent) ----------
function seed() {
  const rCount = db.prepare('SELECT COUNT(*) AS c FROM resources').get().c;
  if (rCount === 0) {
    const ins = db.prepare('INSERT INTO resources (title, url, phone, category, description) VALUES (?, ?, ?, ?, ?)');
    ins.run('SPoD LGBTİQ+', 'https://spod.org.tr', null, 'destek', 'Psikolojik destek, hukuk ve sosyal hizmet danışmanlığı.');
    ins.run('Kaos GL', 'https://kaosgl.org', '0312 230 03 58', 'hukuk', 'İnsan hakları, hukuk desteği ve raporlama.');
    ins.run('TİHEK', 'https://www.tihek.gov.tr', '157', 'hukuk', 'Ayrımcılık başvuruları — Türkiye İnsan Hakları ve Eşitlik Kurumu.');
    ins.run('ALO 183 Sosyal Destek Hattı', null, '183', 'acil', 'Şiddet ve ihmal durumlarında 7/24 sosyal destek hattı.');
    ins.run('Kızılay Danışma Hattı', 'https://www.kizilay.org.tr', '168', 'acil', 'Ücretsiz danışma ve yönlendirme hattı.');
    ins.run('Pembe Hayat', 'https://www.pembehayat.org', null, 'topluluk', 'Trans hakları, dayanışma ağı ve danışmanlık.');
    ins.run('LİSTAG', 'https://www.listag.org', null, 'aile', 'LGBTİQ+ çocukları olan aileler için gruplar ve rehberler.');
    ins.run('Lambdaistanbul', 'https://www.lambdaistanbul.org', null, 'topluluk', 'Gönüllülük, sosyal etkinlikler ve peer destek.');
    ins.run('Bilgi notu', null, null, 'genel', 'Bu liste bilgilendirme amaçlıdır; iletişim kanallarını resmî sitelerden güncel olarak doğrulayın.');
  }
  const nCount = db.prepare('SELECT COUNT(*) AS c FROM notices').get().c;
  if (nCount === 0) {
    const ins = db.prepare('INSERT INTO notices (text) VALUES (?)');
    ins.run('Topluluk duvarı artık açık — rumuzla, güvenle paylaş. 🏳️‍🌈');
    ins.run('Hukuk desteği taleplerine ortalama yanıt süresi: 3 iş günü.');
    ins.run('Destek çantasını doldurmayı unutma: onay verdiğinde güvenilir takip linklerini görebilirsin.');
  }
  // Sohbet duyurusu (bir kez)
  const chatNotice = '💬 Büyük yenilik: Global sohbet, özel mesajlar ve psikolog destek kanalı açıldı!';
  if (!db.prepare('SELECT 1 FROM notices WHERE text=?').get(chatNotice)) {
    db.prepare('INSERT INTO notices (text) VALUES (?)').run(chatNotice);
  }

  // --- Sohbet çekirdekleri ---
  ensureGlobal();
  const scryptHash = (pw) => {
    const salt = crypto.randomBytes(16).toString('hex');
    return `scrypt:${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
  };
  if (!getUserByEmail('system@spektrum.local')) {
    createUser({ email: 'system@spektrum.local', name: 'SPEKTRUM Destek', rumuz: 'SPEKTRUM Destek', role: 'system' });
  }
  const counselorEmail = String(process.env.COUNSELOR_EMAIL || '').trim().toLowerCase();
  const counselorPassword = String(process.env.COUNSELOR_PASSWORD || '');
  const counselorName = String(process.env.COUNSELOR_NAME || 'SPEKTRUM Uzman Ekibi').trim().slice(0, 40) || 'SPEKTRUM Uzman Ekibi';
  const counselorEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(counselorEmail);
  if (counselorEmailValid && counselorPassword.length >= 12 && counselorPassword.length <= 128) {
    const passwordHash = scryptHash(counselorPassword);
    const current = getUserByEmail(counselorEmail);
    if (current) {
      db.prepare(`UPDATE users SET role='counselor', password_hash=?, provider='local', provider_id=NULL,
                  name=?, rumuz=?, support_area='psikolojik', updated_at=? WHERE id=?`)
        .run(passwordHash, counselorName, counselorName, now(), current.id);
    } else {
      createUser({ email: counselorEmail, passwordHash, name: counselorName, rumuz: counselorName, role: 'counselor', supportArea: 'psikolojik' });
    }
  } else if (process.env.NODE_ENV === 'development') {
    // Non-production convenience account. Never create this known password in production.
    const demoCounselor = getUserByEmail('psikolog@spektrum.local');
    const demoPasswordHash = scryptHash('spektrum2026');
    if (demoCounselor) {
      db.prepare(`UPDATE users SET role='counselor', password_hash=?, provider='local', provider_id=NULL,
                  name='SPEKTRUM Uzman Ekibi', rumuz='Uzman Destek', support_area='psikolojik', updated_at=? WHERE id=?`)
        .run(demoPasswordHash, now(), demoCounselor.id);
    } else {
      createUser({
        email: 'psikolog@spektrum.local', passwordHash: demoPasswordHash,
        name: 'SPEKTRUM Uzman Ekibi', rumuz: 'Uzman Destek', role: 'counselor', supportArea: 'psikolojik',
      });
    }
  } else {
    // Older databases may already contain the former demo counselor account. Demote it unless explicitly configured.
    db.prepare(`UPDATE users SET role='member', password_hash=NULL, updated_at=?
                WHERE email='psikolog@spektrum.local' COLLATE NOCASE AND role='counselor'`)
      .run(now());
  }
  // Global sohbeti canlı gösteren örnek üyeler (şifresiz, giriş yapılamaz)
  const seedAccounts = [
    { email: 'morkelebek@spektrum.local', name: 'Mor Kelebek', rumuz: 'MorKelebek' },
    { email: 'gecesiiri@spektrum.local', name: 'Gece Şiiri', rumuz: 'GeceŞiiri' },
  ];
  const seeded = seedAccounts.map((a) => {
    let u = getUserByEmail(a.email);
    if (!u) u = createUser({ ...a, supportArea: 'topluluk' });
    return u;
  });
  const gCount = db.prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id='global'").get().c;
  if (gCount === 0) {
    addMessage('global', seeded[0].id, 'Merhaba! Bu sohbet, topluluk üyelerinin birbirine destek olduğu açık bir alan. Lütfen kişisel bilgilerini paylaşma.');
    addMessage('global', seeded[1].id, 'Hoş geldin. Saygılı ve kapsayıcı bir dil kullanalım; burada herkesin sınırlarına özen gösteriyoruz.');
  }
}
seed();
cleanExpiredSessions();
setInterval(cleanExpiredSessions, 3600 * 1000).unref();

module.exports = {
  newId, now,
  createUser, getUserById, getUserByEmail, getUserByProvider, linkGoogleToUser, updateProfile,
  createSession, getSessionUser, deleteSession,
  createPost, listPosts, getPost, toggleReaction, myReaction, createComment, listComments,
  createRequest, listMyRequests, listAllRequests, updateRequestStatus,
  getSupportPack, upsertSupportPack, listApprovedLinks,
  listNotices, listResources,
  // sohbet
  GLOBAL_CONV_ID, ensureGlobal, getConversation, isMember, upsertMembership, markRead,
  addMessage, listMessages, unreadCount, lastMessage, createConversation,
  getOrCreateDm, getOrCreateSupportConversation, listConversationsFor, listSupportInbox,
  systemMessageExists, getSystemUser, getCounselorUser,
  otherConversationMembers, getSupportConversationOwner, listCounselors,
  // bildirimler
  createNotification, listNotifications, unreadNotificationCount, markNotificationRead, markAllNotificationsRead,
};
