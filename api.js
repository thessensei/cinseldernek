// api.js — üyelere açık API uçları: topluluk, destek talepleri, destek çantası, profil
const db = require('./db');

const CATEGORIES = new Set(['genel', 'psikolojik', 'hukuk', 'topluluk', 'barinma']);
const REQUEST_TYPES = new Set(['psikolojik', 'hukuk', 'barinma', 'topluluk', 'diger']);
const SUPPORT_AREAS = new Set(['psikolojik', 'hukuk', 'barinma', 'topluluk', 'gonullu', 'diger']);
const REQUEST_STATUSES = new Set(['beklemede', 'inceleniyor', 'tamamlandi', 'kapatildi']);
const REQUEST_STATUS_LABELS = { beklemede: 'Beklemede', inceleniyor: 'İnceleniyor', tamamlandi: 'Tamamlandı', kapatildi: 'Kapatıldı' };
const clean = (s, max = 2000) => String(s ?? '').trim().slice(0, max);

function apiRoutes(app, requireAuth, writeLimiter) {
  app.use('/api', requireAuth); // buradan sonrası oturum ister

  // ---- PROFİL ----
  app.patch('/api/me', writeLimiter, (req, res) => {
    const { name, rumuz, supportArea } = req.body || {};
    const nm = clean(name, 40), rz = clean(rumuz, 30), rawArea = clean(supportArea, 30);
    const sa = SUPPORT_AREAS.has(rawArea) ? rawArea : null;
    if (!nm || nm.length < 2) return res.status(400).json({ ok: false, error: 'İsim en az 2 karakter olmalı.' });
    if (!rz || rz.length < 2) return res.status(400).json({ ok: false, error: 'Rumuz en az 2 karakter olmalı.' });
    const u = db.updateProfile(req.user.id, { name: nm, rumuz: rz, supportArea: sa });
    res.json({ ok: true, user: { id: u.id, email: u.email, name: u.name, rumuz: u.rumuz, provider: u.provider, supportArea: u.support_area, role: u.role || 'member', createdAt: u.created_at } });
  });

  // ---- TOPLULUK DUVARI ----
  app.get('/api/posts', (req, res) => {
    const cat = clean(req.query.category, 20);
    const posts = db.listPosts(cat).map((p) => ({
      ...p, mine: p.user_id === req.user.id, supported: db.myReaction(p.id, req.user.id),
    }));
    res.json({ ok: true, posts });
  });

  app.post('/api/posts', writeLimiter, (req, res) => {
    const content = clean(req.body?.content, 500);
    const category = CATEGORIES.has(req.body?.category) ? req.body.category : 'genel';
    if (content.length < 2) return res.status(400).json({ ok: false, error: 'Paylaşım en az 2 karakter olmalı.' });
    const id = db.createPost(req.user.id, category, content);
    res.json({ ok: true, id });
  });

  app.post('/api/posts/:id/react', writeLimiter, (req, res) => {
    const post = db.getPost(req.params.id);
    if (!post) return res.status(404).json({ ok: false, error: 'Paylaşım bulunamadı.' });
    const supported = db.toggleReaction(post.id, req.user.id);
    if (supported && post.user_id !== req.user.id) {
      db.createNotification({
        userId: post.user_id, actorId: req.user.id, type: 'react',
        title: '💜 Paylaşımın desteklendi',
        body: `${req.user.rumuz} paylaşımına destek verdi.`,
        link: post.id,
      });
    }
    res.json({ ok: true, supported });
  });

  app.get('/api/posts/:id/comments', (req, res) => {
    const post = db.getPost(req.params.id);
    if (!post) return res.status(404).json({ ok: false, error: 'Paylaşım bulunamadı.' });
    const comments = db.listComments(post.id).map((c) => ({ ...c, mine: c.user_id === req.user.id }));
    res.json({ ok: true, comments });
  });

  app.post('/api/posts/:id/comments', writeLimiter, (req, res) => {
    const post = db.getPost(req.params.id);
    if (!post) return res.status(404).json({ ok: false, error: 'Paylaşım bulunamadı.' });
    const content = clean(req.body?.content, 300);
    if (content.length < 2) return res.status(400).json({ ok: false, error: 'Yorum en az 2 karakter olmalı.' });
    db.createComment(post.id, req.user.id, content);
    if (post.user_id !== req.user.id) {
      const preview = content.length > 80 ? content.slice(0, 80) + '…' : content;
      db.createNotification({
        userId: post.user_id, actorId: req.user.id, type: 'comment',
        title: '💬 Paylaşımına yorum geldi',
        body: `${req.user.rumuz}: ${preview}`,
        link: post.id,
      });
    }
    res.json({ ok: true });
  });

  // ---- DESTEK TALEPLERİ ----
  app.get('/api/support-requests', (req, res) => {
    res.json({ ok: true, requests: db.listMyRequests(req.user.id) });
  });

  app.post('/api/support-requests', writeLimiter, (req, res) => {
    const type = REQUEST_TYPES.has(req.body?.type) ? req.body.type : 'diger';
    const subject = clean(req.body?.subject, 100);
    const message = clean(req.body?.message, 1500);
    if (subject.length < 3) return res.status(400).json({ ok: false, error: 'Konu en az 3 karakter olmalı.' });
    if (message.length < 10) return res.status(400).json({ ok: false, error: 'Mesaj en az 10 karakter olmalı.' });
    const id = db.createRequest(req.user.id, type, subject, message);
    for (const counselor of db.listCounselors()) {
      db.createNotification({
        userId: counselor.id, actorId: req.user.id, type: 'support_request',
        title: 'Yeni destek talebi', body: `${req.user.rumuz} yeni bir destek talebi oluşturdu.`, link: id,
      });
    }
    res.json({ ok: true, id });
  });

  // Counselor-only queue for reviewing and updating members' support requests.
  app.get('/api/counselor/support-requests', (req, res) => {
    if (req.user.role !== 'counselor') return res.status(403).json({ ok: false, error: 'Bu bölüm yalnızca uzman hesabı içindir.' });
    res.json({ ok: true, requests: db.listAllRequests() });
  });

  app.patch('/api/counselor/support-requests/:id/status', writeLimiter, (req, res) => {
    if (req.user.role !== 'counselor') return res.status(403).json({ ok: false, error: 'Bu işlem yalnızca uzman hesabı içindir.' });
    const status = clean(req.body?.status, 24);
    if (!REQUEST_STATUSES.has(status)) return res.status(400).json({ ok: false, error: 'Geçersiz talep durumu.' });
    const request = db.updateRequestStatus(req.params.id, status);
    if (!request) return res.status(404).json({ ok: false, error: 'Destek talebi bulunamadı.' });
    db.createNotification({
      userId: request.user_id, actorId: req.user.id, type: 'request_status',
      title: 'Destek talebinin durumu güncellendi',
      body: `${request.subject}: ${REQUEST_STATUS_LABELS[status]}.`, link: request.id,
    });
    res.json({ ok: true, request });
  });

  // ---- DESTEK ÇANTASI (üyenin kendi sayfası/takip süreci) ----
  app.get('/api/support-pack/me', (req, res) => {
    const pack = db.getSupportPack(req.user.id);
    res.json({
      ok: true,
      pack: pack ? { approved: !!pack.approved, links: JSON.parse(pack.links), summary: pack.summary, closed: !!pack.closed } : null,
    });
  });

  // Üyenin kendi destek çantası (dosyası) üzerinde yaptığı değişiklikler
  app.post('/api/support-pack', writeLimiter, (req, res) => {
    const body = req.body || {};
    const summary = clean(body.summary, 600);
    let links = Array.isArray(body.links) ? body.links : [];
    links = links
      .map((l) => ({ label: clean(l?.label, 60), url: clean(l?.url, 300) }))
      .filter((l) => l.label && /^https?:\/\//i.test(l.url))
      .slice(0, 5);
    // Consent is explicit and revocable; closed hides links without clearing the saved content.
    const pack = db.upsertSupportPack(req.user.id, {
      approved: !!body.approved,
      links, summary,
      closed: !!body.closed,
    });
    res.json({ ok: true, pack: { approved: !!pack.approved, links: JSON.parse(pack.links), summary: pack.summary, closed: !!pack.closed } });
  });

  // Opt-in links are visible only to members who have also opted in and have not paused sharing.
  app.get('/api/support-pack/approved-links', (req, res) => {
    const mine = db.getSupportPack(req.user.id);
    if (!mine || !mine.approved || mine.closed) {
      return res.status(403).json({ ok: false, error: 'Bu bölüm yalnızca paylaşım izni açık üyelere görünür.' });
    }
    const list = db.listApprovedLinks()
      .map((r) => ({ rumuz: r.rumuz, summary: r.summary, links: JSON.parse(r.links) }));
    res.json({ ok: true, list });
  });

  // ---- BİLDİRİMLER ----
  app.get('/api/notifications', (req, res) => {
    res.json({
      ok: true,
      notifications: db.listNotifications(req.user.id),
      unread: db.unreadNotificationCount(req.user.id),
    });
  });

  app.get('/api/notifications/unread-count', (req, res) => {
    res.json({ ok: true, count: db.unreadNotificationCount(req.user.id) });
  });

  app.post('/api/notifications/read-all', writeLimiter, (req, res) => {
    db.markAllNotificationsRead(req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/notifications/:id/read', writeLimiter, (req, res) => {
    db.markNotificationRead(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  // ---- SABİT İÇERİK ----
  app.get('/api/notices', (req, res) => res.json({ ok: true, notices: db.listNotices() }));
  app.get('/api/resources', (req, res) => res.json({ ok: true, resources: db.listResources() }));
}

module.exports = { apiRoutes };
