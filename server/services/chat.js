import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { schemas } from '../lib/schemas.js';
import { parse } from '../lib/validate.js';
import { cleanMessageBody, codePointLength, nowIso } from '../lib/text.js';
import { getUserRow, isBlockedEitherWay, isBlocking, toPublicUser } from './users.js';

export const MESSAGE_SELECT = `
  SELECT m.id, m.room_id, m.conversation_id, m.author_id, m.body, m.created_at, m.edited_at, m.deleted_at,
         u.username AS author_username, u.display_name AS author_display_name,
         u.avatar_color AS author_avatar_color, u.role AS author_role
  FROM messages m
  LEFT JOIN users u ON u.id = m.author_id`;

const UNREAD_CAP = 100;

export const isMod = (user) => user?.role === 'moderator' || user?.role === 'admin';

export function serializeMessage(row) {
  const deleted = row.deleted_at != null;
  return {
    id: row.id,
    scope: row.room_id != null ? 'room' : 'dm',
    roomId: row.room_id,
    conversationId: row.conversation_id,
    body: deleted ? '' : row.body,
    deleted,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    author:
      row.author_id != null && row.author_username != null
        ? {
            id: row.author_id,
            username: row.author_username,
            displayName: row.author_display_name,
            avatarColor: row.author_avatar_color,
            role: row.author_role,
          }
        : null,
  };
}

export const getMessageRow = (db, id) => db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(id) ?? null;

export function parseMessageBody(raw, maxLength) {
  const { body } = parse(schemas.messageBody, raw);
  const cleaned = cleanMessageBody(body);
  if (!cleaned) throw badRequest('Mesaj boş olamaz.');
  if (codePointLength(cleaned) > maxLength) throw badRequest(`Mesaj en fazla ${maxLength} karakter olabilir.`);
  return cleaned;
}

/* ----------------------------- Odalar ----------------------------- */

export function serializeRoom(row, extra = {}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isReadonly: row.is_readonly === 1,
    isArchived: row.is_archived === 1,
    sortOrder: row.sort_order,
    ...extra,
  };
}

export function resolveRoom(db, ref) {
  const value = String(ref);
  const row = /^\d+$/.test(value)
    ? db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(value))
    : db.prepare('SELECT * FROM rooms WHERE slug = ?').get(value);
  if (!row) throw notFound('Oda');
  return row;
}

export function assertRoomVisible(user, room) {
  if (room.is_archived && !isMod(user)) throw notFound('Oda');
}

export function assertCanPost(user, room) {
  if (room.is_archived) throw forbidden('Bu oda arşivlenmiş ve yeni mesaj kabul etmiyor.');
  if (room.is_readonly && !isMod(user)) throw forbidden('Bu oda yalnızca moderatörler tarafından yazılabilir.');
}

export function countRoomUnread(db, roomId, userId, lastReadId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM messages
         WHERE room_id = @room AND id > @last AND deleted_at IS NULL AND (author_id IS NULL OR author_id != @uid)
         LIMIT ${UNREAD_CAP})`,
    )
    .get({ room: roomId, last: lastReadId, uid: userId }).n;
}

export function listRooms(db, user) {
  const rows = db
    .prepare(
      `SELECT r.*,
         (SELECT MAX(m.created_at) FROM messages m WHERE m.room_id = r.id) AS last_message_at,
         COALESCE((SELECT rr.last_read_id FROM room_reads rr WHERE rr.room_id = r.id AND rr.user_id = @uid), 0) AS last_read_id
       FROM rooms r
       WHERE @mod = 1 OR r.is_archived = 0
       ORDER BY r.sort_order, r.id`,
    )
    .all({ uid: user.id, mod: isMod(user) ? 1 : 0 });
  return rows.map((row) =>
    serializeRoom(row, {
      lastMessageAt: row.last_message_at,
      unread: countRoomUnread(db, row.id, user.id, row.last_read_id),
    }),
  );
}

export function markRoomRead(db, userId, roomId, lastId) {
  db.prepare(
    `INSERT INTO room_reads (user_id, room_id, last_read_id) VALUES (?, ?, ?)
     ON CONFLICT(user_id, room_id) DO UPDATE SET last_read_id = MAX(room_reads.last_read_id, excluded.last_read_id)`,
  ).run(userId, roomId, lastId);
}

/* ---------------------------- Özel mesajlar ---------------------------- */

export const getConversation = (db, id) => db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) ?? null;

export function assertParticipant(conv, userId) {
  if (!conv || (conv.user_low_id !== userId && conv.user_high_id !== userId)) throw notFound('Konuşma');
}

export const otherUserId = (conv, userId) => (conv.user_low_id === userId ? conv.user_high_id : conv.user_low_id);
export const participantIds = (conv) => [conv.user_low_id, conv.user_high_id];

export function findOrCreateConversation(db, a, b) {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  const existing = db.prepare('SELECT * FROM conversations WHERE user_low_id = ? AND user_high_id = ?').get(low, high);
  if (existing) return { conv: existing, created: false };
  const info = db
    .prepare('INSERT INTO conversations (user_low_id, user_high_id, created_at) VALUES (?, ?, ?)')
    .run(low, high, nowIso());
  return { conv: getConversation(db, info.lastInsertRowid), created: true };
}

export function countConversationUnread(db, convId, userId, lastReadId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM messages
         WHERE conversation_id = @conv AND id > @last AND deleted_at IS NULL AND (author_id IS NULL OR author_id != @uid)
         LIMIT ${UNREAD_CAP})`,
    )
    .get({ conv: convId, last: lastReadId, uid: userId }).n;
}

export function markConversationRead(db, userId, convId, lastId) {
  db.prepare(
    `INSERT INTO conversation_reads (user_id, conversation_id, last_read_id) VALUES (?, ?, ?)
     ON CONFLICT(user_id, conversation_id) DO UPDATE SET last_read_id = MAX(conversation_reads.last_read_id, excluded.last_read_id)`,
  ).run(userId, convId, lastId);
}

function selectConversationRows(db, userId, onlyId = null) {
  const params = { uid: userId };
  let extra = '';
  if (onlyId != null) {
    params.cid = onlyId;
    extra = ' AND c.id = @cid';
  }
  return db
    .prepare(
      `SELECT c.id, c.user_low_id, c.user_high_id, c.created_at,
         (SELECT MAX(m.id) FROM messages m WHERE m.conversation_id = c.id) AS last_message_id,
         COALESCE((SELECT cr.last_read_id FROM conversation_reads cr WHERE cr.conversation_id = c.id AND cr.user_id = @uid), 0) AS last_read_id
       FROM conversations c
       WHERE (c.user_low_id = @uid OR c.user_high_id = @uid)${extra}`,
    )
    .all(params);
}

function buildConversationView(db, row, userId, presence) {
  const otherId = otherUserId(row, userId);
  const other = getUserRow(db, otherId);
  const last = row.last_message_id ? getMessageRow(db, row.last_message_id) : null;
  return {
    id: row.id,
    otherUser: other ? toPublicUser(other, presence) : null,
    lastMessage: last ? serializeMessage(last) : null,
    lastActivityAt: last ? last.created_at : row.created_at,
    unread: countConversationUnread(db, row.id, userId, row.last_read_id),
    blockedByMe: isBlocking(db, userId, otherId),
  };
}

export function listConversations(db, userId, presence) {
  return selectConversationRows(db, userId)
    .map((row) => buildConversationView(db, row, userId, presence))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

export function getConversationView(db, convId, userId, presence) {
  assertParticipant(getConversation(db, convId), userId);
  const [row] = selectConversationRows(db, userId, convId);
  return buildConversationView(db, row, userId, presence);
}

/** Bir DM oluşturmadan veya mesaj göndermeden önce iki kullanıcının engel durumunu kontrol eder. */
export function assertCanMessage(db, senderId, recipientId) {
  if (isBlockedEitherWay(db, senderId, recipientId)) {
    throw forbidden('Bu kullanıcıya mesaj gönderemezsiniz.');
  }
}

/* ------------------------------ Mesajlar ------------------------------ */

/** Oda veya konuşma mesajlarını sayfalar. before/after imleçleri desteklenir. */
export function listMessages(db, { roomId = null, conversationId = null, before, after, limit }) {
  const scopeColumn = roomId != null ? 'm.room_id' : 'm.conversation_id';
  const params = { scope: roomId ?? conversationId, limit: limit + 1 };
  if (after != null) {
    params.after = after;
    const rows = db
      .prepare(`${MESSAGE_SELECT} WHERE ${scopeColumn} = @scope AND m.id > @after ORDER BY m.id ASC LIMIT @limit`)
      .all(params);
    return { messages: rows.slice(0, limit), hasMore: rows.length > limit };
  }
  let cursor = '';
  if (before != null) {
    params.before = before;
    cursor = ' AND m.id < @before';
  }
  const rows = db
    .prepare(`${MESSAGE_SELECT} WHERE ${scopeColumn} = @scope${cursor} ORDER BY m.id DESC LIMIT @limit`)
    .all(params);
  return { messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
}

export function insertMessage(db, { roomId = null, conversationId = null, authorId, body }) {
  const info = db
    .prepare('INSERT INTO messages (room_id, conversation_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(roomId, conversationId, authorId, body, nowIso());
  return getMessageRow(db, info.lastInsertRowid);
}

export function updateMessageBody(db, id, body) {
  db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?').run(body, nowIso(), id);
}

export function softDeleteMessage(db, id, byUserId) {
  db.prepare("UPDATE messages SET body = '', deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL").run(
    nowIso(),
    byUserId,
    id,
  );
}

/** Yeni mesajı ilgili kanallara iletir: oda → herkes, DM → yalnızca iki taraf. */
export function emitNewMessage(ctx, row) {
  const message = serializeMessage(row);
  const payload = { type: 'message:new', message };
  if (row.room_id != null) {
    ctx.hub.broadcast(payload);
  } else {
    const conv = getConversation(ctx.db, row.conversation_id);
    ctx.hub.sendToUsers(participantIds(conv), payload);
  }
  return message;
}

/** Düzenleme/silme sonrası güncel mesajı ilgili kanallara iletir. */
export function emitMessageUpdate(ctx, messageId) {
  const row = getMessageRow(ctx.db, messageId);
  if (!row) return;
  const payload = { type: 'message:updated', message: serializeMessage(row) };
  if (row.room_id != null) {
    ctx.hub.broadcast(payload);
  } else {
    const conv = getConversation(ctx.db, row.conversation_id);
    ctx.hub.sendToUsers(participantIds(conv), payload);
  }
}
