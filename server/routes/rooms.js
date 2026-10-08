import { Router } from 'express';
import { tooMany } from '../lib/errors.js';
import { schemas } from '../lib/schemas.js';
import { parse } from '../lib/validate.js';
import {
  assertCanPost,
  assertRoomVisible,
  emitNewMessage,
  insertMessage,
  listMessages,
  listRooms,
  markRoomRead,
  parseMessageBody,
  resolveRoom,
  serializeMessage,
  serializeRoom,
} from '../services/chat.js';

export function roomRoutes(ctx) {
  const { db, config, limiters } = ctx;
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ rooms: listRooms(db, req.user) });
  });

  // ref: oda kimliği (sayı) veya slug
  router.get('/:ref/messages', (req, res) => {
    const room = resolveRoom(db, req.params.ref);
    assertRoomVisible(req.user, room);
    const query = parse(schemas.history, req.query);
    const { messages, hasMore } = listMessages(db, { roomId: room.id, ...query });
    res.json({ room: serializeRoom(room), messages: messages.map(serializeMessage), hasMore });
  });

  router.post('/:ref/messages', (req, res) => {
    const room = resolveRoom(db, req.params.ref);
    assertRoomVisible(req.user, room);
    assertCanPost(req.user, room);
    if (!limiters.message.hit(`msg:${req.user.id}`)) {
      throw tooMany('Çok hızlı mesaj gönderiyorsunuz. Lütfen birkaç saniye bekleyin.');
    }
    const body = parseMessageBody(req.body, config.messageMaxLength);
    const row = insertMessage(db, { roomId: room.id, authorId: req.user.id, body });
    const message = emitNewMessage(ctx, row);
    res.status(201).json({ message });
  });

  router.post('/:ref/read', (req, res) => {
    const room = resolveRoom(db, req.params.ref);
    assertRoomVisible(req.user, room);
    const { lastMessageId } = parse(schemas.readMark, req.body);
    markRoomRead(db, req.user.id, room.id, lastMessageId);
    res.status(204).end();
  });

  return router;
}
