import { Router } from 'express';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import {
  assertCanPost,
  assertParticipant,
  assertRoomVisible,
  emitMessageUpdate,
  getConversation,
  getMessageRow,
  isMod,
  parseMessageBody,
  serializeMessage,
  softDeleteMessage,
  updateMessageBody,
} from '../services/chat.js';
import { parseId } from '../lib/validate.js';

/** Mesajın bulunduğu odaya/konuşmaya erişim hakkını doğrular. */
function assertMessageAccess(db, row, user) {
  if (row.room_id != null) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(row.room_id);
    if (!room) throw notFound('Mesaj');
    assertRoomVisible(user, room);
    return room;
  }
  assertParticipant(getConversation(db, row.conversation_id), user.id);
  return null;
}

export function messageRoutes(ctx) {
  const { db, config } = ctx;
  const router = Router();

  router.patch('/:id', (req, res) => {
    const row = getMessageRow(db, parseId(req.params.id));
    if (!row) throw notFound('Mesaj');
    if (row.author_id !== req.user.id) throw forbidden('Yalnızca kendi mesajınızı düzenleyebilirsiniz.');
    if (row.deleted_at) throw conflict('Silinmiş mesaj düzenlenemez.');
    const room = assertMessageAccess(db, row, req.user);
    if (room) assertCanPost(req.user, room);
    const body = parseMessageBody(req.body, config.messageMaxLength);
    if (body !== row.body) {
      updateMessageBody(db, row.id, body);
      emitMessageUpdate(ctx, row.id);
    }
    res.json({ message: serializeMessage(getMessageRow(db, row.id)) });
  });

  router.delete('/:id', (req, res) => {
    const row = getMessageRow(db, parseId(req.params.id));
    if (!row) throw notFound('Mesaj');
    const isAuthor = row.author_id === req.user.id;
    assertMessageAccess(db, row, req.user);
    if (row.room_id != null) {
      // Oda mesajlarını moderatörler de silebilir.
      if (!isAuthor && !isMod(req.user)) throw forbidden('Bu mesajı silme yetkiniz yok.');
    } else if (!isAuthor) {
      // Özel mesajlara moderatörler doğrudan müdahale edemez; yalnızca şikayet üzerinden.
      throw forbidden('Özel mesajları yalnızca gönderen silebilir. Uygunsuz içerik için şikayet edin.');
    }
    if (row.deleted_at) return res.status(204).end();
    softDeleteMessage(db, row.id, req.user.id);
    if (!isAuthor) {
      audit(db, {
        actorId: req.user.id,
        action: 'message.deleted_by_mod',
        targetType: 'message',
        targetId: row.id,
        details: { roomId: row.room_id, authorId: row.author_id },
      });
    }
    emitMessageUpdate(ctx, row.id);
    return res.status(204).end();
  });

  return router;
}
