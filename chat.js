// chat.js — Sohbet API: global sohbet, özel mesaj (DM), psikolog destek kanalı
const db = require('./db');

const clean = (s, max = 1000) => String(s ?? '').trim().slice(0, max);

// Yetki kontrolü: global herkese açık; DM yalnızca üyelerine; destek kanalı sahibine VE uzmanlara açık
function canAccess(user, convo) {
  if (!convo) return false;
  if (convo.type === 'global') return true;
  if (db.isMember(convo.id, user.id)) return true;
  if (convo.type === 'support' && user.role === 'counselor') return true;
  return false;
}

function serializeMessages(rows, meId) {
  return rows.map((m) => ({
    id: m.id, content: m.content, createdAt: m.created_at, mine: m.user_id === meId,
    author: { id: m.user_id, rumuz: m.rumuz || 'SPEKTRUM Destek', role: m.author_role || 'system' },
  }));
}

// Yeni mesaj bildirimi: DM'de karşı tarafa; destek kanalında üye ↔ uzman eşleşmesi.
// Global oda bildirim üretmez (çok gürültülü olurdu).
function notifyNewMessage(convo, sender, content) {
  if (!sender || sender.role === 'system') return;
  const preview = content.length > 80 ? content.slice(0, 80) + '…' : content;
  if (convo.type === 'dm') {
    for (const peer of db.otherConversationMembers(convo.id, sender.id)) {
      db.createNotification({
        userId: peer.id, actorId: sender.id, type: 'dm',
        title: '✉️ Yeni özel mesaj',
        body: `${sender.rumuz}: ${preview}`,
        link: convo.id,
      });
    }
    return;
  }
  if (convo.type === 'support') {
    if (sender.role === 'member') {
      for (const c of db.listCounselors()) {
        db.createNotification({
          userId: c.id, actorId: sender.id, type: 'support_msg',
          title: '🧠 Danışan kanalında yeni mesaj',
          body: `${sender.rumuz}: ${preview}`,
          link: convo.id,
        });
      }
    } else {
      // uzman → danışan
      const owner = db.getSupportConversationOwner(convo.id);
      if (owner) {
        db.createNotification({
          userId: owner.id, actorId: sender.id, type: 'support_msg',
          title: '🧠 Psikolog destek kanalında yeni mesaj',
          body: `${sender.rumuz}: ${preview}`,
          link: convo.id,
        });
      }
    }
  }
}

function chatRoutes(app, requireAuth, writeLimiter) {
  app.use('/api/chat', requireAuth);

  // --- Sohbet listesi (DM + destek) ---
  app.get('/api/chat/conversations', (req, res) => {
    const list = db.listConversationsFor(req.user.id).map((c) => ({
      id: c.id, type: c.type,
      peer: c.peer,                                // dm: karşı taraf; support+uzman: danışan; support+üye: null (sabit başlık)
      last: c.last, unread: c.unread,
    }));
    res.json({ ok: true, conversations: list });
  });

  // Okunmamış toplamı (DM + destek; global hariç — orası herkese açık oda)
  app.get('/api/chat/unread-count', (req, res) => {
    const total = db.listConversationsFor(req.user.id).reduce((a, c) => a + c.unread, 0);
    res.json({ ok: true, count: total });
  });

  // --- DM başlat / bul ---
  app.post('/api/chat/dm', writeLimiter, (req, res) => {
    const target = db.getUserById(String(req.body?.userId || ''));
    if (!target || target.role === 'system') return res.status(404).json({ ok: false, error: 'Kullanıcı bulunamadı.' });
    if (target.id === req.user.id) return res.status(400).json({ ok: false, error: 'Kendinle sohbet başlatamazsın 😄' });
    // Uzmanlara direkt DM yerine psikolog destek kanalı kullanılır
    if (target.role === 'counselor' && req.user.role !== 'counselor') {
      const convId = db.getOrCreateSupportConversation(req.user.id);
      return res.json({ ok: true, redirect: 'support', conversationId: convId, info: 'Uzmanlarımızla iletişim Psikolog Destek kanalından ilerler 💜' });
    }
    const convId = db.getOrCreateDm(req.user.id, target.id);
    res.json({ ok: true, conversationId: convId, peer: { id: target.id, rumuz: target.rumuz, role: target.role } });
  });

  // --- Global sohbet ---
  app.get('/api/chat/global', (req, res) => {
    db.ensureGlobal();
    db.upsertMembership(db.GLOBAL_CONV_ID, req.user.id);
    res.json({ ok: true, conversationId: db.GLOBAL_CONV_ID });
  });

  // --- Psikolog destek kanalı (üye için kendi kanalını açar) ---
  app.get('/api/chat/support', (req, res) => {
    if (req.user.role === 'counselor') {
      return res.status(400).json({ ok: false, error: 'Uzmanlar için destek gelen kutusu sekmesini kullanın.' });
    }
    const convId = db.getOrCreateSupportConversation(req.user.id);
    res.json({ ok: true, conversationId: convId });
  });

  // --- Uzman gelen kutusu (tüm danışan sohbetleri) ---
  app.get('/api/chat/support/inbox', (req, res) => {
    if (req.user.role !== 'counselor') return res.status(403).json({ ok: false, error: 'Bu bölüm yalnızca uzman üyeler içindir.' });
    res.json({
      ok: true,
      inbox: db.listSupportInbox().map((c) => ({
        id: c.id, owner: c.owner, last: c.last, unread: db.unreadCount(c.id, req.user.id),
      })),
    });
  });

  // --- Mesajları getir (okundu işaretler) ---
  app.get('/api/chat/:id/messages', (req, res) => {
    const convo = db.getConversation(req.params.id);
    if (!canAccess(req.user, convo)) return res.status(403).json({ ok: false, error: 'Bu sohbete erişimin yok.' });
    if (convo.type === 'global') db.upsertMembership(convo.id, req.user.id);
    if (convo.type !== 'global' && db.isMember(convo.id, req.user.id)) db.markRead(convo.id, req.user.id);
    if (convo.type === 'support' && req.user.role === 'counselor') { db.upsertMembership(convo.id, req.user.id); db.markRead(convo.id, req.user.id); }
    res.json({ ok: true, messages: serializeMessages(db.listMessages(convo.id), req.user.id) });
  });

  // --- Mesaj gönder ---
  app.post('/api/chat/:id/messages', writeLimiter, (req, res) => {
    const convo = db.getConversation(req.params.id);
    if (!canAccess(req.user, convo)) return res.status(403).json({ ok: false, error: 'Bu sohbete erişimin yok.' });
    const content = clean(req.body?.content, 1000);
    if (content.length < 1) return res.status(400).json({ ok: false, error: 'Boş mesaj gönderilemez.' });

    db.addMessage(convo.id, req.user.id, content);
    if (convo.type !== 'global') { db.upsertMembership(convo.id, req.user.id); db.markRead(convo.id, req.user.id); }
    else db.upsertMembership(convo.id, req.user.id);

    // Bildirim: karşı tarafa haber ver (global hariç)
    notifyNewMessage(convo, req.user, content);

    // Psikolog destek kanalı: ilk temasta sıcak otomatik karşılama (üye yazdıysa ve daha önce sistem yazmadıysa)
    if (convo.type === 'support' && req.user.role === 'member' && !db.systemMessageExists(convo.id)) {
      const sys = db.getSystemUser();
      if (sys && !db.systemMessageExists(convo.id)) {
        db.addMessage(convo.id, sys.id,
          'Mesajın bize ulaştı 💜 Bu kanal yalnızca sen ve uzman destek ekibimiz arasında — diğer üyeler göremez. ' +
          'Uzman psikologlarımız genellikle 24–48 saat içinde yanıtlar. ' +
          'Kendine ya da bir başkasına zarar verme riski taşıyan ACİL bir durumdaysan beklemeden 112\'yi veya 183 Sosyal Destek Hattı\'nı ara. Yalnız değilsin.');
      }
    }

    res.json({ ok: true });
  });
}

module.exports = { chatRoutes };
