import { api } from './api.js';
import { emit, store } from './store.js';

/**
 * WebSocket istemcisi: bağlantı, yeniden bağlanma (1 sn → 15 sn), yedek yoklama ve
 * çevrimiçi durumu. Sunucu 4001/4003 ile kapatırsa yeniden bağlanılmaz.
 */
let socket = null;
let stopped = true;
let attempts = 0;
let reconnectTimer = null;
let pingTimer = null;
let pollDelayTimer = null;
let pollTimer = null;
let typingSentAt = 0;

const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

function setStatus(status) {
  if (store.state.wsStatus !== status) store.set({ wsStatus: status });
}

export function startRealtime() {
  if (!store.state.user) return;
  stopped = false;
  attempts = 0;
  connect();
}

export function stopRealtime() {
  stopped = true;
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);
  stopPolling();
  if (socket) {
    const current = socket;
    socket = null;
    current.close(1000, 'bye');
  }
  setStatus('offline');
  store.set({ online: new Set() });
}

function connect() {
  if (stopped) return;
  setStatus(attempts === 0 ? 'connecting' : 'reconnecting');
  const ws = new WebSocket(wsUrl());
  socket = ws;

  ws.addEventListener('open', () => {
    attempts = 0;
    setStatus('online');
    stopPolling();
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: 'ping' }), 25_000);
    emit('resync');
  });

  ws.addEventListener('message', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    handle(data);
  });

  ws.addEventListener('close', (event) => {
    clearInterval(pingTimer);
    if (socket === ws) socket = null;
    if (stopped) return;
    if (event.code === 4001 || event.code === 4003) {
      stopped = true;
      setStatus('offline');
      emit('revoked', { code: event.code });
      return;
    }
    setStatus('reconnecting');
    schedulePolling();
    attempts += 1;
    // Üst üste başarısız denemelerde oturumun hâlâ geçerli olup olmadığını kontrol et.
    if (attempts === 3) {
      api.get('/api/auth/me').then(({ user }) => {
        if (!user) emit('revoked', { code: 4001 });
      }).catch(() => {});
    }
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(attempts - 1, 4));
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  });
}

function schedulePolling() {
  if (pollDelayTimer || pollTimer) return;
  pollDelayTimer = setTimeout(() => {
    pollDelayTimer = null;
    pollTimer = setInterval(() => emit('poll'), 4000);
  }, 10_000);
}

function stopPolling() {
  clearTimeout(pollDelayTimer);
  clearInterval(pollTimer);
  pollDelayTimer = null;
  pollTimer = null;
}

export function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

/** Yazıyor bilgisini en fazla 2 sn'de bir gönderir; false ise hemen durdurur. */
export function sendTyping(scope, id, typing) {
  const now = Date.now();
  if (typing && now - typingSentAt < 2000) return;
  if (typing) typingSentAt = now;
  else typingSentAt = 0;
  send({ type: 'typing', scope, id, typing });
}

function handle(data) {
  switch (data.type) {
    case 'hello':
      store.set({ user: { ...store.state.user, ...data.user }, online: new Set(data.online) });
      break;
    case 'presence': {
      const online = new Set(store.state.online);
      if (data.online) online.add(data.userId);
      else online.delete(data.userId);
      store.set({ online });
      emit('presence', data);
      break;
    }
    case 'message:new':
    case 'message:updated':
      emit('message', { type: data.type, message: data.message });
      break;
    case 'typing':
      emit('typing', data);
      break;
    case 'rooms:changed':
      emit('rooms:changed');
      break;
    case 'conversations:changed':
      emit('conversations:changed');
      break;
    case 'user:updated':
      if (store.state.user && data.user.id === store.state.user.id) {
        store.set({ user: { ...store.state.user, ...data.user } });
      }
      emit('user:updated', data.user);
      break;
    case 'auth:revoked':
      stopped = true;
      emit('revoked', { code: 4001, reason: data.reason });
      break;
    case 'settings:changed':
      store.set({ settings: data.settings });
      break;
    case 'reports:changed':
      emit('reports:changed');
      break;
    default:
      break;
  }
}
