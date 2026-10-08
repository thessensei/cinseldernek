import { Router } from 'express';
import { badRequest, forbidden, notFound, tooMany } from '../lib/errors.js';
import { schemas } from '../lib/schemas.js';
import { parse, parseId } from '../lib/validate.js';
import {
  assertCanMessage,
  assertParticipant,
  emitNewMessage,
  findOrCreateConversation,
  getConversation,
  getConversationView,
  insertMessage,
  listConversations,
  listMessages,
  markConversationRead,
  otherUserId,
  parseMessageBody,
  serializeMessage,
} from '../services/chat.js';
import { getUserRow } from '../services/users.js';

export function dmRoutes(ctx) {
  const { db, config, limiters, presence } = ctx;
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ conversations: listConversations(db, req.user.id, presence) });
  });

  router.post('/', (req, res) => {
    const { userId } = parse(schemas.createDm, req.body);
    if (userId === req.user.id) throw badRequest('Kendinize mesaj gönderemezsiniz.');
    const target = getUserRow(db, userId);
    if (!target || target.status !== 'active') throw notFound('Kullanıcı');
    assertCanMessage(db, req.user.id, userId);
    const { conv, created } = findOrCreateConversation(db, req.user.id, userId);
    if (created) ctx.hub.sendToUsers([req.user.id, userId], { type: 'conversations:changed' });
    res.status(created ? 201 : 200).json({
      conversation: getConversationView(db, conv.id, req.user.id, presence),
    });
  });

  router.get('/:id/messages', (req, res) => {
    const conv = getConversation(db, parseId(req.params.id));
    assertParticipant(conv, req.user.id);
    const query = parse(schemas.history, req.query);
    const { messages, hasMore } = listMessages(db, { conversationId: conv.id, ...query });
    res.json({
      conversation: getConversationView(db, conv.id, req.user.id, presence),
      messages: messages.map(serializeMessage),
      hasMore,
    });
  });

  router.post('/:id/messages', (req, res) => {
    const conv = getConversation(db, parseId(req.params.id));
    assertParticipant(conv, req.user.id);
    const recipientId = otherUserId(conv, req.user.id);
    const recipient = getUserRow(db, recipientId);
    if (!recipient || recipient.status !== 'active') throw forbidden('Bu kullanıcıya mesaj gönderemezsiniz.');
    assertCanMessage(db, req.user.id, recipientId);
    if (!limiters.message.hit(`msg:${req.user.id}`)) {
      throw tooMany('Çok hızlı mesaj gönderiyorsunuz. Lütfen birkaç saniye bekleyin.');
    }
    const body = parseMessageBody(req.body, config.messageMaxLength);
    const row = insertMessage(db, { conversationId: conv.id, authorId: req.user.id, body });
    const message = emitNewMessage(ctx, row);
    res.status(201).json({ message });
  });

  router.post('/:id/read', (req, res) => {
    const conv = getConversation(db, parseId(req.params.id));
    assertParticipant(conv, req.user.id);
    const { lastMessageId } = parse(schemas.readMark, req.body);
    markConversationRead(db, req.user.id, conv.id, lastMessageId);
    res.status(204).end();
  });

  return router;
}
