import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, makeUser, promote, startServer } from './helpers.js';

let env;
before(async () => {
  env = await startServer();
});
after(async () => {
  await env.stop();
});

async function createRoom(admin, body) {
  const res = await admin.post('/api/admin/rooms', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.room;
}

describe('kimlik doğrulama', () => {
  it('kayıt olur, oturum çerezi verir ve geçersiz girdileri reddeder', async () => {
    const bad = await new Client(env.base).post('/api/auth/register', { username: 'a', email: 'x', password: '123' });
    assert.equal(bad.status, 400);

    const client = new Client(env.base);
    const ok = await client.register('ayse_k', 'GucluParola1');
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.username, 'ayse_k');
    assert.equal(ok.body.user.email, 'ayse_k@test.dev');
    assert.equal(ok.body.user.role, 'user');
    assert.ok(client.cookie?.startsWith('sid='), 'oturum çerezi ayarlanmalı');
    assert.equal(ok.body.user.passwordHash, undefined, 'parola özeti asla dönmemeli');

    const dup = await new Client(env.base).register('AYSE_K', 'GucluParola1');
    assert.equal(dup.status, 409);

    const me = await client.get('/api/auth/me');
    assert.equal(me.body.user.username, 'ayse_k');
    const anon = await new Client(env.base).get('/api/auth/me');
    assert.equal(anon.body.user, null);
  });

  it('giriş rumuz veya e-posta ile yapılır; yanlış parola reddedilir', async () => {
    await makeUser(env, 'mehmet_t', {});
    const wrong = await new Client(env.base).login('mehmet_t', 'yanlis-parola');
    assert.equal(wrong.status, 401);
    const byUser = await new Client(env.base).login('MEHMET_T');
    assert.equal(byUser.status, 200);
    const byEmail = await new Client(env.base).login('mehmet_t@test.dev');
    assert.equal(byEmail.status, 200);
  });

  it('çıkış yapınca oturum geçersiz olur', async () => {
    const client = await makeUser(env, 'cikis_test');
    const token = client.cookie;
    assert.equal((await client.get('/api/rooms')).status, 200);
    assert.equal((await client.post('/api/auth/logout')).status, 204);
    const stale = new Client(env.base);
    stale.cookie = token;
    assert.equal((await stale.get('/api/rooms')).status, 401);
  });

  it('çapraz site istekleri ve JSON dışı gövdeler reddedilir', async () => {
    const client = await makeUser(env, 'csrf_test');
    const crossSite = await client.request('POST', '/api/dms', { userId: 1 }, {
      Origin: 'https://evil.example',
      'Sec-Fetch-Site': 'cross-site',
    });
    assert.equal(crossSite.status, 403);

    const textBody = await fetch(env.base + '/api/rooms/genel/messages', {
      method: 'POST',
      headers: { Cookie: client.cookie, 'Content-Type': 'text/plain', Origin: env.base },
      body: '{"body":"x"}',
    });
    assert.equal(textBody.status, 415);
  });

  it('hız sınırı: art arda hatalı girişler 429 ile durdurulur', async () => {
    const limited = await startServer({ limits: { login: { windowMs: 60_000, max: 2 } } });
    try {
      const attacker = new Client(limited.base);
      for (let i = 0; i < 2; i += 1) {
        assert.equal((await attacker.login('yok_kullanici', 'x'.repeat(8))).status, 401);
      }
      assert.equal((await attacker.login('yok_kullanici', 'x'.repeat(8))).status, 429);
    } finally {
      await limited.stop();
    }
  });
});

describe('sohbet odaları ve oda mesajları', () => {
  it('mesaj gönderme, geçmiş, okunmamış sayısı ve okundu işareti', async () => {
    const admin = await makeUser(env, 'oda_admin');
    promote(env, admin, 'admin');
    const room = await createRoom(admin, { name: 'Test Odası', description: 'Deneme' });
    assert.equal(room.slug, 'test-odasi');

    const alice = await makeUser(env, 'alice_room');
    const bob = await makeUser(env, 'bob_room');

    const sent = await alice.post(`/api/rooms/${room.slug}/messages`, { body: '  Merhaba  ' });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.body, 'Merhaba', 'baştaki/sondaki boşluklar temizlenmeli');
    assert.equal(sent.body.message.author.username, 'alice_room');

    const rooms = await bob.get('/api/rooms');
    assert.equal(rooms.body.rooms.find((r) => r.slug === 'test-odasi').unread, 1);

    const history = await bob.get(`/api/rooms/${room.id ?? room.slug}/messages`);
    assert.equal(history.body.messages.length, 1);

    assert.equal((await bob.post(`/api/rooms/${room.slug}/read`, { lastMessageId: sent.body.message.id })).status, 204);
    const after = await bob.get('/api/rooms');
    assert.equal(after.body.rooms.find((r) => r.slug === 'test-odasi').unread, 0);
  });

  it('salt okunur odaya yalnızca moderatörler yazabilir', async () => {
    const admin = await makeUser(env, 'duyuru_admin');
    promote(env, admin, 'admin');
    const room = await createRoom(admin, { name: 'Duyurular Test', isReadonly: true });
    const user = await makeUser(env, 'duyuru_user');
    assert.equal((await user.post(`/api/rooms/${room.slug}/messages`, { body: 'selam' })).status, 403);
    assert.equal((await admin.post(`/api/rooms/${room.slug}/messages`, { body: 'duyuru' })).status, 201);
  });

  it('mesaj doğrulaması: boş ve çok uzun mesajlar reddedilir', async () => {
    const admin = await makeUser(env, 'uzun_admin');
    promote(env, admin, 'admin');
    const room = await createRoom(admin, { name: 'Uzunluk Odası' });
    const user = await makeUser(env, 'uzun_user');
    assert.equal((await user.post(`/api/rooms/${room.slug}/messages`, { body: '   \n  ' })).status, 400);
    assert.equal((await user.post(`/api/rooms/${room.slug}/messages`, { body: 'a'.repeat(2001) })).status, 400);
    assert.equal((await user.post(`/api/rooms/${room.slug}/messages`, { body: 'a'.repeat(2000) })).status, 201);
  });

  it('kendi mesajını düzenleyebilir; başkasının mesajını düzenleyemez; moderatör siler', async () => {
    const admin = await makeUser(env, 'sil_admin');
    promote(env, admin, 'admin');
    const room = await createRoom(admin, { name: 'Düzenleme Odası' });
    const author = await makeUser(env, 'yazar_user');
    const other = await makeUser(env, 'diger_user');

    const msg = (await author.post(`/api/rooms/${room.slug}/messages`, { body: 'ilk hali' })).body.message;
    const edited = await author.patch(`/api/messages/${msg.id}`, { body: 'düzeltilmiş' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.message.body, 'düzeltilmiş');
    assert.ok(edited.body.message.editedAt);
    assert.equal((await other.patch(`/api/messages/${msg.id}`, { body: 'hack' })).status, 403);

    assert.equal((await other.del(`/api/messages/${msg.id}`)).status, 403, 'sıradan kullanıcı başkasının mesajını silemez');
    assert.equal((await admin.del(`/api/messages/${msg.id}`)).status, 204, 'yönetici oda mesajını silebilir');
    const history = await other.get(`/api/rooms/${room.slug}/messages`);
    const deleted = history.body.messages.find((m) => m.id === msg.id);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.body, '');
  });
});

describe('özel mesajlar (DM)', () => {
  it('iki kişi konuşur, üçüncü kişi konuşmayı göremez', async () => {
    const ali = await makeUser(env, 'dm_ali');
    const veli = await makeUser(env, 'dm_veli');
    const eve = await makeUser(env, 'dm_eve');

    assert.equal((await ali.post('/api/dms', { userId: ali.user.id })).status, 400, 'kendine DM yasak');
    const created = await ali.post('/api/dms', { userId: veli.user.id });
    assert.equal(created.status, 201);
    const again = await veli.post('/api/dms', { userId: ali.user.id });
    assert.equal(again.status, 200, 'aynı çift için tek konuşma');
    assert.equal(again.body.conversation.id, created.body.conversation.id);

    const convId = created.body.conversation.id;
    const sent = await ali.post(`/api/dms/${convId}/messages`, { body: 'Gizli selam' });
    assert.equal(sent.status, 201);

    const veliList = await veli.get('/api/dms');
    const conv = veliList.body.conversations.find((c) => c.id === convId);
    assert.equal(conv.unread, 1);
    assert.equal(conv.otherUser.username, 'dm_ali');
    assert.equal(conv.lastMessage.body, 'Gizli selam');

    assert.equal((await eve.get(`/api/dms/${convId}/messages`)).status, 404);
    assert.equal((await eve.post(`/api/dms/${convId}/messages`, { body: 'girmek istiyorum' })).status, 404);
    assert.equal((await eve.get('/api/dms')).body.conversations.length, 0);
  });

  it('engelleme: engellenen kişi mesaj gönderemez; engel kaldırılınca tekrar yazılır', async () => {
    const x = await makeUser(env, 'engel_x');
    const y = await makeUser(env, 'engel_y');
    const conv = (await x.post('/api/dms', { userId: y.user.id })).body.conversation;

    assert.equal((await y.post(`/api/users/${x.user.id}/block`)).status, 204);
    assert.equal((await x.post(`/api/dms/${conv.id}/messages`, { body: 'merhaba' })).status, 403);
    assert.equal((await y.post(`/api/dms/${conv.id}/messages`, { body: 'merhaba' })).status, 403, 'engelleyen de yazamaz');
    assert.equal((await x.post('/api/dms', { userId: y.user.id })).status, 403, 'engel varken konuşma açılamaz');

    const yView = (await y.get('/api/dms')).body.conversations.find((c) => c.id === conv.id);
    assert.equal(yView.blockedByMe, true);

    assert.equal((await y.del(`/api/users/${x.user.id}/block`)).status, 204);
    assert.equal((await x.post(`/api/dms/${conv.id}/messages`, { body: 'tekrar merhaba' })).status, 201);
  });

  it('engelleme kişisel listede görünür ve kendini engelleyemezsin', async () => {
    const p = await makeUser(env, 'blok_liste');
    const q = await makeUser(env, 'blok_hedef');
    assert.equal((await p.post(`/api/users/${p.user.id}/block`)).status, 400);
    await p.post(`/api/users/${q.user.id}/block`);
    const blocks = await p.get('/api/me/blocks');
    assert.deepEqual(blocks.body.users.map((u) => u.username), ['blok_hedef']);
  });
});

describe('profil ve parola', () => {
  it('profil güncellenir; geçersiz renk reddedilir', async () => {
    const client = await makeUser(env, 'profil_user');
    const ok = await client.patch('/api/me', { displayName: 'Yeni İsim', bio: 'Selam', avatarColor: '#00e676' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.displayName, 'Yeni İsim');
    assert.equal(ok.body.user.bio, 'Selam');
    assert.equal((await client.patch('/api/me', { avatarColor: 'kırmızı' })).status, 400);
  });

  it('parola değişince diğer oturumlar kapanır', async () => {
    const client = await makeUser(env, 'parola_user');
    const other = new Client(env.base);
    await other.login('parola_user');
    assert.equal((await client.post('/api/me/password', { currentPassword: 'yanlış', newPassword: 'YeniParola1' })).status, 400);
    assert.equal((await client.post('/api/me/password', { currentPassword: 'Parola123!', newPassword: 'YeniParola1' })).status, 204);
    assert.equal((await other.get('/api/rooms')).status, 401);
    assert.equal((await client.get('/api/rooms')).status, 200);
    assert.equal((await new Client(env.base).login('parola_user', 'Parola123!')).status, 401);
    assert.equal((await new Client(env.base).login('parola_user', 'YeniParola1')).status, 200);
  });

  it('hesap silme: içerik temizlenir, kimlik anonimleşir', async () => {
    const admin = await makeUser(env, 'hesap_admin');
    promote(env, admin, 'admin');
    const room = await createRoom(admin, { name: 'Silme Odası' });
    const leaver = await makeUser(env, 'ayrilan_user');
    await leaver.post(`/api/rooms/${room.slug}/messages`, { body: 'veda' });
    assert.equal((await leaver.post('/api/me/delete', { password: 'yanlış' })).status, 400);
    assert.equal((await leaver.post('/api/me/delete', { password: 'Parola123!' })).status, 204);
    assert.equal((await new Client(env.base).login('ayrilan_user')).status, 401);
    const history = await admin.get(`/api/rooms/${room.slug}/messages`);
    assert.equal(history.body.messages.find((m) => m.body === 'veda'), undefined);
    const tombstone = history.body.messages.find((m) => m.deleted);
    assert.ok(tombstone, 'silinen mesaj yer tutucu olarak kalmalı');
    assert.equal(tombstone.body, '');
    assert.match(tombstone.author.username, /^silinmis-\d+$/, 'kimlik anonimleşmeli');
  });
});

describe('blog', () => {
  it('taslaklar herkese gizli, yayınlananlar görünür; HTML kaçışlanır', async () => {
    const admin = await makeUser(env, 'blog_admin');
    promote(env, admin, 'admin');
    const draft = await admin.post('/api/admin/posts', {
      title: 'Taslak Yazı',
      bodyMd: 'Gizli içerik',
      status: 'draft',
      tags: ['Rehber', 'güvenlik'],
    });
    assert.equal(draft.status, 201);
    assert.equal((await new Client(env.base).get(`/api/blog/posts/${draft.body.post.slug}`)).status, 404);

    const published = await admin.post('/api/admin/posts', {
      title: 'Yayın Yazısı',
      excerpt: 'Özet',
      bodyMd: '# Başlık\n\n<script>alert(1)</script> **kalın**',
      status: 'published',
      tags: ['Rehber'],
    });
    assert.equal(published.status, 201);
    const slug = published.body.post.slug;
    const detail = await new Client(env.base).get(`/api/blog/posts/${slug}`);
    assert.equal(detail.status, 200);
    assert.match(detail.body.post.html, /<h1>Başlık<\/h1>/);
    assert.match(detail.body.post.html, /<strong>kalın<\/strong>/);
    assert.doesNotMatch(detail.body.post.html, /<script>/i, 'ham HTML etiketleri çalıştırılmamalı');
    assert.equal(detail.body.post.views, 1);

    const list = await new Client(env.base).get('/api/blog/posts');
    assert.ok(list.body.posts.some((p) => p.slug === slug));
    assert.ok(!list.body.posts.some((p) => p.title === 'Taslak Yazı'));
    const byTag = await new Client(env.base).get('/api/blog/posts?tag=rehber');
    assert.ok(byTag.body.posts.some((p) => p.slug === slug));
    const tags = await new Client(env.base).get('/api/blog/tags');
    assert.ok(tags.body.tags.some((t) => t.tag === 'rehber'));
  });

  it('aynı başlıklı yazılar benzersiz slug alır; yorumlar yalnızca oturumla yazılır', async () => {
    const admin = await makeUser(env, 'slug_admin');
    promote(env, admin, 'admin');
    const a = await admin.post('/api/admin/posts', { title: 'Aynı Başlık', status: 'published' });
    const b = await admin.post('/api/admin/posts', { title: 'Aynı Başlık', status: 'published' });
    assert.notEqual(a.body.post.slug, b.body.post.slug);

    const slug = a.body.post.slug;
    assert.equal((await new Client(env.base).post(`/api/blog/posts/${slug}/comments`, { body: 'anonim' })).status, 401);
    const commenter = await makeUser(env, 'yorumcu');
    const comment = await commenter.post(`/api/blog/posts/${slug}/comments`, { body: 'Harika yazı!' });
    assert.equal(comment.status, 201);
    const comments = await new Client(env.base).get(`/api/blog/posts/${slug}/comments`);
    assert.equal(comments.body.comments.length, 1);
    assert.equal(comments.body.comments[0].author.username, 'yorumcu');
    assert.equal((await commenter.del(`/api/blog/comments/${comment.body.comment.id}`)).status, 204);
    assert.equal((await new Client(env.base).get(`/api/blog/posts/${slug}/comments`)).body.comments.length, 0);
  });
});

describe('moderasyon, şikayetler ve yönetim paneli', () => {
  it('rol kontrolleri: sıradan kullanıcı panele giremez, moderatör rol değiştiremez', async () => {
    const admin = await makeUser(env, 'rol_admin');
    promote(env, admin, 'admin');
    const plain = await makeUser(env, 'rol_plain');
    const mod = await makeUser(env, 'rol_mod');
    promote(env, mod, 'moderator');

    assert.equal((await plain.get('/api/admin/stats')).status, 403);
    assert.equal((await mod.get('/api/admin/stats')).status, 200);
    assert.equal((await mod.patch(`/api/admin/users/${plain.user.id}`, { role: 'admin' })).status, 403);
    assert.equal((await admin.patch(`/api/admin/users/${admin.user.id}`, { role: 'user' })).status, 400, 'kendi rolünü değiştiremez');
    assert.equal((await admin.patch(`/api/admin/users/${plain.user.id}`, { role: 'moderator' })).status, 200);
    assert.equal((await admin.patch(`/api/admin/users/${plain.user.id}`, { role: 'user' })).status, 200);
  });

  it('şikayet → moderasyon: mesaj silinir, kullanıcı yasaklanır, oturum kapanır', async () => {
    const admin = await makeUser(env, 'sik_admin');
    promote(env, admin, 'admin');
    const room = await createRoom(admin, { name: 'Şikayet Odası' });
    const reporter = await makeUser(env, 'sikayetci');
    const abuser = await makeUser(env, 'kotu_niyetli');
    const msg = (await abuser.post(`/api/rooms/${room.slug}/messages`, { body: 'uygunsuz içerik' })).body.message;

    assert.equal((await reporter.post('/api/reports', { reason: 'spam', messageId: 999999 })).status, 404);
    const report = await reporter.post('/api/reports', { reason: 'taciz', messageId: msg.id, details: 'Rahatsız edici' });
    assert.equal(report.status, 201);
    assert.equal((await reporter.post('/api/reports', { reason: 'taciz', messageId: msg.id })).status, 409);
    assert.equal((await abuser.post('/api/reports', { reason: 'spam', messageId: msg.id })).status, 400, 'kendini şikayet edemez');

    const queue = await admin.get('/api/admin/reports?status=open');
    const item = queue.body.reports.find((r) => r.id === report.body.report.id);
    assert.equal(item.snapshot.message.body, 'uygunsuz içerik');
    assert.equal(item.reportedUser.username, 'kotu_niyetli');

    const resolved = await admin.post(`/api/admin/reports/${item.id}/resolve`, {
      outcome: 'resolved',
      deleteMessage: true,
      banUser: true,
      note: 'Kurallara aykırı',
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.report.status, 'resolved');
    assert.equal((await admin.post(`/api/admin/reports/${item.id}/resolve`, { outcome: 'dismissed' })).status, 409);

    const history = await admin.get(`/api/rooms/${room.slug}/messages`);
    assert.equal(history.body.messages.find((m) => m.id === msg.id).body, '');
    assert.equal((await abuser.get('/api/rooms')).status, 401, 'yasaklanan kullanıcının oturumu kapanır');
    const login = await new Client(env.base).login('kotu_niyetli');
    assert.equal(login.status, 403);
    assert.match(login.body.error.message, /askıya/);

    const audit = await admin.get('/api/admin/audit');
    const actions = audit.body.logs.map((l) => l.action);
    assert.ok(actions.includes('user.banned'));
    assert.ok(actions.includes('report.resolved'));
  });

  it('moderatör yasaklar; yönetici parola sıfırlar; kayıt kapatılıp açılır', async () => {
    const admin = await makeUser(env, 'ayar_admin');
    promote(env, admin, 'admin');
    const mod = await makeUser(env, 'ayar_mod');
    promote(env, mod, 'moderator');
    const target = await makeUser(env, 'ayar_hedef');

    assert.equal((await mod.patch(`/api/admin/users/${admin.user.id}`, { status: 'banned' })).status, 403, 'moderatör yöneticiyi yasaklayamaz');
    const banned = await mod.patch(`/api/admin/users/${target.user.id}`, { status: 'banned', banReason: 'Test' });
    assert.equal(banned.status, 200);
    assert.equal(banned.body.user.status, 'banned');
    assert.equal((await mod.patch(`/api/admin/users/${target.user.id}`, { status: 'active' })).status, 200);

    const reset = await admin.post(`/api/admin/users/${target.user.id}/reset-password`);
    assert.equal(reset.status, 200);
    assert.equal((await target.get('/api/rooms')).status, 401);
    assert.equal((await new Client(env.base).login('ayar_hedef', reset.body.temporaryPassword)).status, 200);

    assert.equal((await admin.put('/api/admin/settings', { registrationOpen: false })).status, 200);
    assert.equal((await new Client(env.base).register('kapali_kayit')).status, 403);
    assert.equal((await new Client(env.base).get('/api/settings/public')).body.registrationOpen, false);
    await admin.put('/api/admin/settings', { registrationOpen: true, announcement: 'Bakım bu gece' });
    assert.equal((await new Client(env.base).get('/api/settings/public')).body.announcement, 'Bakım bu gece');
  });

  it('oda yönetimi: oluşturma, düzenleme, arşivleme ve silme', async () => {
    const admin = await makeUser(env, 'oda_yonetici');
    promote(env, admin, 'admin');
    const user = await makeUser(env, 'oda_ziyaretci');
    const room = await createRoom(admin, { name: 'Geçici Oda' });
    const patched = await admin.patch(`/api/admin/rooms/${room.id}`, { name: 'Güncel Oda', isArchived: true });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.room.name, 'Güncel Oda');
    assert.equal((await user.get(`/api/rooms/${room.slug}/messages`)).status, 404, 'arşivli oda kullanıcıya kapalı');
    assert.equal((await admin.del(`/api/admin/rooms/${room.id}`)).status, 204);
    assert.equal((await user.get('/api/rooms')).body.rooms.some((r) => r.id === room.id), false);
  });
});
