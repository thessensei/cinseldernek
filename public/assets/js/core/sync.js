import { api, withQuery } from './api.js';
import { emit, on, store } from './store.js';

/**
 * Genel senkronizasyon: oda/DM listeleri, okunmamış sayaçları ve gelen mesajların
 * sidebar'a yansıması. Açık olan konuşma okunmuş sayılır.
 */

function recount() {
  const unreadRooms = store.state.rooms.reduce((sum, room) => sum + (room.isArchived ? 0 : room.unread || 0), 0);
  const unreadDms = store.state.conversations.reduce((sum, conv) => sum + (conv.unread || 0), 0);
  store.set({ unreadRooms, unreadDms });
}

export async function refreshRooms() {
  if (!store.state.user) return;
  const { rooms } = await api.get('/api/rooms');
  store.set({ rooms });
  recount();
}

export async function refreshConversations() {
  if (!store.state.user) return;
  const { conversations } = await api.get('/api/dms');
  store.set({ conversations });
  recount();
}

export async function refreshAll() {
  await Promise.allSettled([refreshRooms(), refreshConversations()]);
}

/** Okundu işaretini sunucuya yazar ve yerel sayacı sıfırlar. */
export async function markRead(scope, id, lastMessageId) {
  if (!lastMessageId) return;
  if (scope === 'room') {
    await api.post(`/api/rooms/${id}/read`, { lastMessageId });
    store.set({
      rooms: store.state.rooms.map((room) => (room.id === id ? { ...room, unread: 0 } : room)),
    });
  } else {
    await api.post(`/api/dms/${id}/read`, { lastMessageId });
    store.set({
      conversations: store.state.conversations.map((conv) => (conv.id === id ? { ...conv, unread: 0 } : conv)),
    });
  }
  recount();
}

function isActiveThread(scope, id) {
  const active = store.state.activeThread;
  return Boolean(active && active.scope === scope && active.id === id && document.visibilityState === 'visible');
}

function onMessage({ type, message }) {
  const me = store.state.user;
  const mine = message.author?.id === me?.id;

  if (message.scope === 'room') {
    const rooms = store.state.rooms;
    const room = rooms.find((r) => r.id === message.roomId);
    if (!room) {
      if (type === 'message:new') refreshRooms();
      return;
    }
    if (type === 'message:new') {
      const active = isActiveThread('room', room.id);
      const unread = active || mine ? 0 : (room.unread || 0) + 1;
      store.set({
        rooms: rooms.map((r) => (r.id === room.id ? { ...r, unread, lastMessageAt: message.createdAt } : r)),
      });
      if (active) markRead('room', room.id, message.id).catch(() => {});
      recount();
    }
    return;
  }

  const conversations = store.state.conversations;
  const conv = conversations.find((c) => c.id === message.conversationId);
  if (!conv) {
    if (type === 'message:new') refreshConversations();
    return;
  }
  const active = isActiveThread('dm', conv.id);
  const updated = { ...conv };
  if (type === 'message:new') {
    updated.lastMessage = message;
    updated.lastActivityAt = message.createdAt;
    updated.unread = active || mine ? 0 : (conv.unread || 0) + 1;
  } else if (conv.lastMessage?.id === message.id) {
    updated.lastMessage = message;
  }
  store.set({
    conversations: [updated, ...conversations.filter((c) => c.id !== conv.id)].sort((a, b) =>
      (b.lastActivityAt || '').localeCompare(a.lastActivityAt || ''),
    ),
  });
  if (active && type === 'message:new') markRead('dm', conv.id, message.id).catch(() => {});
  recount();
}

export function initSync() {
  on('message', (event) => onMessage(event.detail));
  on('rooms:changed', () => refreshRooms().catch(() => {}));
  on('conversations:changed', () => refreshConversations().catch(() => {}));
  on('resync', () => refreshAll());
  on('poll', () => refreshAll());
  on('reports:changed', () => refreshReportCount());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const active = store.state.activeThread;
    if (!active) return;
    const list = active.scope === 'room' ? store.state.rooms : store.state.conversations;
    const item = list.find((x) => x.id === active.id);
    const lastId = active.scope === 'room' ? active.lastId : item?.lastMessage?.id;
    if (lastId) markRead(active.scope, active.id, lastId).catch(() => {});
  });
  emit('sync:ready');
}

export async function refreshReportCount() {
  if (!['moderator', 'admin'].includes(store.state.user?.role)) return;
  try {
    const { reports, total } = await api.get(withQuery('/api/admin/reports', { status: 'open', limit: 1 }));
    store.set({ reportsOpen: total ?? reports.length });
  } catch {
    // Sayaç isteğe bağlıdır.
  }
}
