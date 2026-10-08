import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, makeUser, openSocket, promote, sleep, startServer } from './helpers.js';

let env;
before(async () => {
  env = await startServer();
});
after(async () => {
  await env.stop();
});

async function createRoom(admin, name) {
  return (await admin.post('/api/admin/rooms', { name })).body.room;
}

describe('WebSocket gerçek zamanlı katman', () => {
  it('oturumsuz ve farklı kaynaktan gelen bağlantılar reddedilir', async () => {
    await assert.rejects(openSocket(new Client(env.base)), /401/);
    const user = await makeUser(env, 'ws_reject');
    await assert.rejects(openSocket(user, { origin: 'https://evil.example' }), /403/);
  });

  it('bağlanınca hello alınır; çevrimiçi durumu yayınlanır', async () => {
    const a = await makeUser(env, 'ws_presence_a');
    const b = await makeUser(env, 'ws_presence_b');
    const sockA = await openSocket(a);
    const hello = await sockA.waitFor((e) => e.type === 'hello');
    assert.equal(hello.user.username, 'ws_presence_a');
    assert.ok(Array.isArray(hello.online));

    const sockB = await openSocket(b);
    const online = await sockA.waitFor((e) => e.type === 'presence' && e.userId === b.user.id && e.online);
    assert.equal(online.online, true);

    sockB.close();
    const offline = await sockA.waitFor((e) => e.type === 'presence' && e.userId === b.user.id && !e.online);
    assert.ok(offline.lastSeenAt);
    sockA.close();
  });

  it('oda mesajı herkese, DM yalnızca iki tarafa iletilir', async () => {
    const admin = await makeUser(env, 'ws_admin');
    promote(env, admin, 'admin');
    const room = await createRoom(admin, 'Canlı Oda');
    const sender = await makeUser(env, 'ws_sender');
    const friend = await makeUser(env, 'ws_friend');
    const spy = await makeUser(env, 'ws_spy');

    const sockSender = await openSocket(sender);
    const sockFriend = await openSocket(friend);
    const sockSpy = await openSocket(spy);

    const roomPost = await sender.post(`/api/rooms/${room.slug}/messages`, { body: 'Herkese selam' });
    const roomEvent = await sockSpy.waitFor((e) => e.type === 'message:new' && e.message.id === roomPost.body.message.id);
    assert.equal(roomEvent.message.body, 'Herkese selam');

    const conv = (await sender.post('/api/dms', { userId: friend.user.id })).body.conversation;
    await sockFriend.waitFor((e) => e.type === 'conversations:changed');
    const dm = await sender.post(`/api/dms/${conv.id}/messages`, { body: 'Sadece sen' });
    const friendEvent = await sockFriend.waitFor((e) => e.type === 'message:new' && e.message.id === dm.body.message.id);
    assert.equal(friendEvent.message.scope, 'dm');
    await sleep(200);
    const spyLeaked = sockSpy.events.some((e) => e.type === 'message:new' && e.message.id === dm.body.message.id);
    assert.equal(spyLeaked, false, 'üçüncü kişi DM olayını görmemeli');
    assert.ok(sockSender.events.some((e) => e.type === 'message:new' && e.message.id === dm.body.message.id));

    sockSender.close();
    sockFriend.close();
    sockSpy.close();
  });

  it('yazıyor bilgisi DM karşı tarafına iletilir', async () => {
    const left = await makeUser(env, 'typ_left');
    const right = await makeUser(env, 'typ_right');
    const conv = (await left.post('/api/dms', { userId: right.user.id })).body.conversation;
    const sockLeft = await openSocket(left);
    const sockRight = await openSocket(right);
    sockLeft.ws.send(JSON.stringify({ type: 'typing', scope: 'dm', id: conv.id, typing: true }));
    const typing = await sockRight.waitFor((e) => e.type === 'typing');
    assert.equal(typing.user.username, 'typ_left');
    assert.equal(typing.typing, true);
    sockLeft.close();
    sockRight.close();
  });

  it('ping/pong çalışır; bilinmeyen olaylar hata döner', async () => {
    const user = await makeUser(env, 'ws_ping');
    const sock = await openSocket(user);
    sock.ws.send(JSON.stringify({ type: 'ping' }));
    await sock.waitFor((e) => e.type === 'pong');
    sock.ws.send(JSON.stringify({ type: 'gibberish' }));
    const error = await sock.waitFor((e) => e.type === 'error');
    assert.match(error.message, /Bilinmeyen/);
    sock.close();
  });

  it('yasaklama ve çıkış, açık bağlantıları kapatır', async () => {
    const admin = await makeUser(env, 'ws_ban_admin');
    promote(env, admin, 'admin');
    const victim = await makeUser(env, 'ws_victim');
    const logoutUser = await makeUser(env, 'ws_logout');
    const sockVictim = await openSocket(victim);
    const sockLogout = await openSocket(logoutUser);

    await admin.patch(`/api/admin/users/${victim.user.id}`, { status: 'banned', banReason: 'Test' });
    const { code } = await sockVictim.closed;
    assert.equal(code, 4003);
    const revoked = sockVictim.events.find((e) => e.type === 'auth:revoked');
    assert.equal(revoked.reason, 'banned');

    await logoutUser.post('/api/auth/logout');
    const { code: logoutCode } = await sockLogout.closed;
    assert.equal(logoutCode, 4001);
  });
});
