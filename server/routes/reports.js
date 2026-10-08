import { Router } from 'express';
import { badRequest, conflict, notFound, tooMany } from '../lib/errors.js';
import { schemas } from '../lib/schemas.js';
import { nowIso } from '../lib/text.js';
import { parse } from '../lib/validate.js';
import { assertParticipant, getConversation, getMessageRow, assertRoomVisible } from '../services/chat.js';
import { buildMessageSnapshot, buildUserSnapshot } from '../services/reports.js';
import { getUserRow } from '../services/users.js';

export function reportRoutes(ctx) {
  const { db, limiters, presence } = ctx;
  const router = Router();

  router.post('/', (req, res) => {
    if (!limiters.report.hit(`report:${req.user.id}`)) {
      throw tooMany('Çok fazla şikayet gönderdiniz. Lütfen daha sonra tekrar deneyin.');
    }
    const input = parse(schemas.report, req.body);
    if (!input.messageId && !input.userId) {
      throw badRequest('Şikayet edilecek bir mesaj veya kullanıcı belirtilmeli.');
    }

    let message = null;
    let reportedUserId = input.userId ?? null;
    if (input.messageId) {
      message = getMessageRow(db, input.messageId);
      if (!message) throw notFound('Mesaj');
      if (message.room_id != null) {
        const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(message.room_id);
        assertRoomVisible(req.user, room);
      } else {
        assertParticipant(getConversation(db, message.conversation_id), req.user.id);
      }
      reportedUserId = message.author_id;
    }
    if (reportedUserId != null && reportedUserId === req.user.id) {
      throw badRequest('Kendinizi şikayet edemezsiniz.');
    }
    if (!message) {
      const target = getUserRow(db, reportedUserId);
      if (!target || target.status !== 'active') throw notFound('Kullanıcı');
    }

    const duplicate = message
      ? db.prepare("SELECT id FROM reports WHERE reporter_id = ? AND status = 'open' AND message_id = ?").get(req.user.id, message.id)
      : db
          .prepare("SELECT id FROM reports WHERE reporter_id = ? AND status = 'open' AND message_id IS NULL AND reported_user_id = ?")
          .get(req.user.id, reportedUserId);
    if (duplicate) throw conflict('Bu içeriği zaten şikayet ettiniz. Moderatörler inceliyor.');

    const snapshot = message ? buildMessageSnapshot(db, message) : buildUserSnapshot(db, reportedUserId, presence);
    const info = db
      .prepare(
        `INSERT INTO reports (reporter_id, message_id, reported_user_id, reason, details, snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        req.user.id,
        message ? message.id : null,
        reportedUserId,
        input.reason,
        input.details ?? '',
        JSON.stringify(snapshot),
        nowIso(),
      );
    ctx.hub.sendToStaff({ type: 'reports:changed' });
    res.status(201).json({ report: { id: Number(info.lastInsertRowid) } });
  });

  return router;
}
