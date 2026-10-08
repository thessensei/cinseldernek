import { nowIso } from '../lib/text.js';
import { MESSAGE_SELECT, getMessageRow, serializeMessage } from './chat.js';
import { getUserRow, toAdminUser, toPublicUser } from './users.js';

/** Şikayet anındaki mesajın ve öncesindeki 5 mesajın anlık görüntüsünü alır. */
export function buildMessageSnapshot(db, row) {
  const scopeColumn = row.room_id != null ? 'm.room_id' : 'm.conversation_id';
  const scopeId = row.room_id ?? row.conversation_id;
  const context = db
    .prepare(`${MESSAGE_SELECT} WHERE ${scopeColumn} = ? AND m.id < ? ORDER BY m.id DESC LIMIT 5`)
    .all(scopeId, row.id)
    .reverse();
  return {
    scope: row.room_id != null ? 'room' : 'dm',
    roomId: row.room_id,
    conversationId: row.conversation_id,
    message: serializeMessage(row),
    context: context.map(serializeMessage),
    capturedAt: nowIso(),
  };
}

export function buildUserSnapshot(db, userId, presence) {
  const user = getUserRow(db, userId);
  return {
    scope: 'user',
    user: user ? toPublicUser(user, presence) : null,
    context: [],
    capturedAt: nowIso(),
  };
}

const parseJson = (text, fallback) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};

export function serializeReport(db, row, presence) {
  const reporter = row.reporter_id ? getUserRow(db, row.reporter_id) : null;
  const reported = row.reported_user_id ? getUserRow(db, row.reported_user_id) : null;
  const current = row.message_id ? getMessageRow(db, row.message_id) : null;
  return {
    id: row.id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    resolution: parseJson(row.resolution, null),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    reporter: reporter ? toPublicUser(reporter, presence) : null,
    reportedUser: reported ? toAdminUser(reported, presence) : null,
    messageId: row.message_id,
    messageDeleted: current ? current.deleted_at != null : null,
    snapshot: parseJson(row.snapshot, {}),
  };
}
