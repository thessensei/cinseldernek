import { WebSocketServer } from 'ws';
import { isRequestSameOrigin } from '../middleware/security.js';
import { readCookie } from '../lib/http.js';
import { nowIso } from '../lib/text.js';
import { findSessionUser } from '../services/auth.js';
import { assertCanMessage, assertRoomVisible, getConversation, assertParticipant, otherUserId, participantIds, isMod } from '../services/chat.js';
import { getUserRow, toSelfUser } from '../services/users.js';

const OPEN = 1;
const HEARTBEAT_MS = 30_000;

/**
 * Gerçek zamanlı katman (WebSocket, /ws).
 * - Bağlantı, oturum çerezi ile kimlik doğrulanır (Origin kontrolü dahil).
 * - Oda mesajları tüm bağlı kullanıcılara, DM'ler yalnızca iki tarafa iletilir.
 */
export function createHub({ httpServer, db, config, presence, limiters }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const clients = new Map(); // ws -> { userId, sessionHash, alive }
  let closing = false;

  function send(ws, event) {
    if (ws.readyState === OPEN) ws.send(JSON.stringify(event));
  }

  function sendToUser(userId, event) {
    for (const ws of presence.socketsOf(userId)) send(ws, event);
  }

  function sendToUsers(userIds, event) {
    for (const id of new Set(userIds)) sendToUser(id, event);
  }

  function broadcast(event, exceptWs = null) {
    const data = JSON.stringify(event);
    for (const ws of clients.keys()) {
      if (ws !== exceptWs && ws.readyState === OPEN) ws.send(data);
    }
  }

  function sendToStaff(event) {
    for (const [ws, client] of clients) {
      const user = getUserRow(db, client.userId);
      if (user && user.status === 'active' && isMod(user)) send(ws, event);
    }
  }

  /** Kullanıcının (isteğe bağlı olarak belirli oturum hariç) tüm bağlantılarını kapatır. */
  function revokeUser(userId, { exceptHash = null, event = { type: 'auth:revoked' }, code = 4001 } = {}) {
    for (const [ws, client] of clients) {
      if (client.userId !== userId) continue;
      if (exceptHash && client.sessionHash === exceptHash) continue;
      send(ws, event);
      ws.close(code, event.type);
    }
  }

  function revokeSession(sessionHash) {
    for (const [ws, client] of clients) {
      if (client.sessionHash !== sessionHash) continue;
      send(ws, { type: 'auth:revoked', reason: 'logout' });
      ws.close(4001, 'logout');
    }
  }

  function reject(socket, status, text) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      pathname = '';
    }
    if (pathname !== '/ws') return reject(socket, 404, 'Not Found');
    if (!isRequestSameOrigin(req, config)) return reject(socket, 403, 'Forbidden');
    const session = findSessionUser(db, readCookie(req.headers.cookie, config.cookie.name));
    if (!session) return reject(socket, 401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws, session));
  });

  function attach(ws, session) {
    const userId = session.user.id;
    const client = { userId, sessionHash: session.tokenHash, alive: true };
    clients.set(ws, client);
    const first = presence.add(userId, ws);
    send(ws, { type: 'hello', user: toSelfUser(session.user), online: presence.onlineIds(), serverTime: nowIso() });
    if (first) broadcast({ type: 'presence', userId, online: true }, ws);

    ws.on('pong', () => {
      client.alive = true;
    });
    ws.on('message', (raw) => handleMessage(ws, client, raw));
    ws.on('close', () => {
      clients.delete(ws);
      if (closing) return; // sunucu kapanırken veritabanına yazma
      if (presence.remove(userId, ws)) {
        const lastSeenAt = nowIso();
        db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(lastSeenAt, userId);
        broadcast({ type: 'presence', userId, online: false, lastSeenAt });
      }
    });
    ws.on('error', () => {
      // 'close' olayı bağlantıyı temizler.
    });
  }

  function handleMessage(ws, client, raw) {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: 'error', message: 'Geçersiz istek.' });
    }
    if (!event || typeof event !== 'object') return undefined;
    if (event.type === 'ping') return send(ws, { type: 'pong', at: Date.now() });
    if (event.type === 'typing') return handleTyping(ws, client, event);
    return send(ws, { type: 'error', message: 'Bilinmeyen olay.' });
  }

  function handleTyping(ws, client, event) {
    const scope = event.scope;
    const id = Number(event.id);
    if ((scope !== 'room' && scope !== 'dm') || !Number.isSafeInteger(id)) return;
    if (!limiters.typing.hit(`typing:${client.userId}`)) return;
    const user = getUserRow(db, client.userId);
    if (!user || user.status !== 'active') return;
    const payload = {
      type: 'typing',
      scope,
      id,
      typing: event.typing !== false,
      user: { id: user.id, username: user.username, displayName: user.display_name },
    };
    if (scope === 'room') {
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
      if (!room) return;
      try {
        assertRoomVisible(user, room);
      } catch {
        return;
      }
      broadcast(payload, ws);
      return;
    }
    const conv = getConversation(db, id);
    try {
      assertParticipant(conv, user.id);
      assertCanMessage(db, user.id, otherUserId(conv, user.id));
    } catch {
      return;
    }
    sendToUsers(participantIds(conv).filter((uid) => uid !== user.id), payload);
  }

  const heartbeat = setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.alive) {
        ws.terminate();
        continue;
      }
      client.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  /** Tüm bağlantıları kapatır ve kapanış olaylarının bitmesini bekler (veritabanı kapanmadan önce). */
  function close() {
    closing = true;
    clearInterval(heartbeat);
    const pending = [...clients.keys()].map(
      (ws) =>
        new Promise((resolve) => {
          ws.once('close', resolve);
          ws.terminate();
        }),
    );
    return Promise.all(pending).then(() => {
      wss.close();
    });
  }

  return { broadcast, sendToUser, sendToUsers, sendToStaff, revokeUser, revokeSession, close };
}
