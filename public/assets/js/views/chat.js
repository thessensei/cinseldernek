import { api } from '../core/api.js';
import { debounce, h } from '../core/dom.js';
import { navigate, isCurrent } from '../core/router.js';
import { on, store, isStaff } from '../core/store.js';
import { refreshConversations, refreshRooms } from '../core/sync.js';
import { mountShell, setTitle } from '../components/layout.js';
import { avatar, errorText, roleBadge } from '../components/ui.js';
import { createThread } from '../components/thread.js';
import { openReportModal, openUserCard } from '../components/usercard.js';
import { confirmDialog, toast } from '../components/feedback.js';

let layout = null; // { root, side, roomsList, dmsList, results, threadHost }
let current = null; // aktif thread (destroy edilebilir)
let subscribed = false;

const me = () => store.state.user;

function previewOf(conv) {
  const last = conv.lastMessage;
  if (!last) return 'Henüz mesaj yok';
  if (last.deleted) return 'Mesaj silindi';
  const prefix = last.author?.id === me()?.id ? 'Sen: ' : '';
  const text = last.body.replace(/\s+/g, ' ').trim();
  return prefix + (text.length > 48 ? `${text.slice(0, 48)}…` : text);
}

function renderLists() {
  if (!layout || !layout.root.isConnected) return;
  const { rooms, conversations, online } = store.state;
  const activeThread = store.state.activeThread;

  layout.roomsList.replaceChildren(
    ...rooms.map((room) => {
      const active = activeThread?.scope === 'room' && activeThread.id === room.id;
      const icon = room.isArchived ? '🗄️' : room.isReadonly ? '📢' : '#';
      return h(
        'a',
        { class: 'side-item', href: `/app/room/${room.slug}`, 'aria-current': active ? 'page' : undefined, title: room.description },
        h('span', { class: 'hash', 'aria-hidden': 'true' }, icon),
        h('span', { class: 'meta' }, h('span', { class: 'name truncate' }, room.name)),
        room.unread ? h('span', { class: 'badge badge-unread', 'aria-label': `${room.unread} okunmamış` }, room.unread > 99 ? '99+' : String(room.unread)) : null,
      );
    }),
  );

  layout.dmsList.replaceChildren(
    ...(conversations.length
      ? conversations.map((conv) => {
          const other = conv.otherUser;
          const active = activeThread?.scope === 'dm' && activeThread.id === conv.id;
          return h(
            'a',
            { class: 'side-item', href: `/app/dm/${conv.id}`, 'aria-current': active ? 'page' : undefined },
            avatar(other ?? { displayName: '?' }, 30),
            h(
              'span',
              { class: 'meta' },
              h('span', { class: 'name truncate' }, other?.displayName ?? 'Silinmiş üye'),
              h('span', { class: 'side-preview' }, previewOf(conv)),
            ),
            other && online.has(other.id) ? h('span', { class: 'dot dot-online', title: 'Çevrimiçi' }) : null,
            conv.unread ? h('span', { class: 'badge badge-unread' }, conv.unread > 99 ? '99+' : String(conv.unread)) : null,
          );
        })
      : [h('p', { class: 'side-count', style: { padding: '0 0.6rem' } }, 'Henüz özel konuşmanız yok. Aşağıdan bir üye arayıp mesaj gönderebilirsiniz.')]),
  );
}

async function startDm(userId) {
  try {
    const { conversation } = await api.post('/api/dms', { userId });
    await refreshConversations();
    layout?.root.classList.remove('show-side');
    navigate(`/app/dm/${conversation.id}`);
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

function renderResults(users) {
  if (!layout) return;
  if (!users.length) {
    layout.results.replaceChildren(h('p', { class: 'side-count', style: { padding: '0 0.6rem' } }, 'Eşleşen üye bulunamadı.'));
    return;
  }
  layout.results.replaceChildren(
    ...users.map((user) =>
      h(
        'div',
        { class: 'user-chip' },
        h('button', { type: 'button', class: 'link-btn grow', style: { textAlign: 'left', display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }, onclick: () => openUserCard(user.id) },
          avatar(user, 28),
          h('span', { class: 'name truncate' }, user.displayName),
          h('span', { class: `dot ${user.online ? 'dot-online' : ''}` }),
        ),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => startDm(user.id), 'aria-label': `${user.displayName} ile özel mesaj` }, 'Mesaj'),
      ),
    ),
  );
}

function ensureLayout(main) {
  if (layout && main.contains(layout.root)) return layout;
  const roomsList = h('div', { class: 'side-list' });
  const dmsList = h('div', { class: 'side-list' });
  const results = h('div', { class: 'side-list' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Üye ara…', 'aria-label': 'Üye ara', maxlength: 60 });
  const runSearch = debounce(async () => {
    const term = search.value.trim();
    if (!term) {
      results.replaceChildren();
      return;
    }
    try {
      const { users } = await api.get(`/api/users?q=${encodeURIComponent(term)}&limit=12`);
      renderResults(users);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }, 300);
  search.addEventListener('input', runSearch);

  const side = h(
    'aside',
    { class: 'side', id: 'side', 'aria-label': 'Sohbet listesi' },
    h('button', { class: 'btn btn-sm side-close', type: 'button', onclick: () => root.classList.remove('show-side') }, '✕ Kapat'),
    h('div', { class: 'side-head' }, h('span', { class: 'side-title' }, 'Odalar')),
    roomsList,
    h('div', { class: 'side-head' }, h('span', { class: 'side-title' }, 'Özel mesajlar')),
    dmsList,
    h('div', { class: 'side-head' }, h('span', { class: 'side-title' }, 'Üyeler')),
    h('div', { class: 'side-search' }, search),
    results,
  );
  const threadHost = h('div', { class: 'chat-main', id: 'chat-main' });
  const root = h('div', { class: 'chat' }, side, threadHost);
  main.replaceChildren(root);
  layout = { root, side, roomsList, dmsList, results, threadHost };
  renderLists();
  if (!subscribed) {
    subscribed = true;
    store.subscribe((event) => {
      const keys = event.detail?.keys ?? [];
      if (keys.some((key) => ['rooms', 'conversations', 'online', 'activeThread', 'user'].includes(key))) renderLists();
    });
  }
  return layout;
}

function setThread(node, thread) {
  if (current) current.destroy();
  current = thread;
  layout.threadHost.replaceChildren(node);
  renderLists();
}

function toggleSideButton() {
  return h(
    'button',
    { class: 'btn btn-sm btn-ghost side-toggle', type: 'button', 'aria-label': 'Sohbet listesini aç', onclick: () => layout.root.classList.toggle('show-side') },
    '☰ Liste',
  );
}

function emptyPanel(title, text) {
  return h('div', { class: 'chat-empty' }, h('h2', null, title), h('p', null, text));
}

async function showWelcome() {
  let rooms = store.state.rooms;
  if (!rooms.length) {
    await refreshRooms().catch(() => {});
    if (!layout) return;
    rooms = store.state.rooms;
  }
  const preferred = rooms.find((room) => room.slug === 'genel') ?? rooms.find((room) => !room.isReadonly && !room.isArchived);
  if (preferred) {
    navigate(`/app/room/${preferred.slug}`, { replace: true });
    return;
  }
  setThread(
    h('div', { class: 'thread' }, emptyPanel('Hoş geldin! 🏳️‍🌈', 'Sol taraftan bir oda seçerek sohbete katılabilir ya da bir üyeye özel mesaj gönderebilirsin.')),
    null,
  );
}

async function showRoom(slug, renderId) {
  let room = store.state.rooms.find((r) => r.slug === slug);
  if (!room) {
    await refreshRooms().catch(() => {});
    if (!isCurrent(renderId)) return;
    room = store.state.rooms.find((r) => r.slug === slug);
  }
  if (!room) {
    setThread(h('div', { class: 'thread' }, emptyPanel('Oda bulunamadı', 'Bu oda mevcut değil veya erişiminiz yok.')), null);
    return;
  }
  setTitle(room.name);
  const staff = isStaff(me());
  const canPost = !room.isArchived && (!room.isReadonly || staff);
  const notice = room.isArchived
    ? 'Bu oda arşivlendi. Yalnızca moderatörler mesajları görebilir.'
    : room.isReadonly
      ? 'Bu oda duyuru odasıdır; yalnızca yöneticiler yazabilir.'
      : null;
  const composerNote = room.isArchived ? 'Arşivlenmiş odalara mesaj gönderilemez.' : 'Bu odaya yalnızca yöneticiler yazabilir.';
  store.set({ activeThread: { scope: 'room', id: room.id, lastId: null } });

  const head = h(
    'div',
    { class: 'chat-head' },
    toggleSideButton(),
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'title' }, `${room.isReadonly ? '📢' : '#'} ${room.name}`),
      h('div', { class: 'subtitle truncate' }, room.description || 'Sohbet odası'),
    ),
  );
  const thread = createThread({ scope: 'room', id: room.id, canPost, notice, composerNote });
  setThread(h('div', { class: 'thread', style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, head, thread.el), thread);
  thread.load().catch((err) => {
    if (isCurrent(renderId)) toast(errorText(err), 'error');
  });
}

async function showDm(convId, renderId) {
  let conv = store.state.conversations.find((c) => c.id === convId);
  if (!conv) {
    await refreshConversations().catch(() => {});
    if (!isCurrent(renderId)) return;
    conv = store.state.conversations.find((c) => c.id === convId);
  }
  if (!conv || !conv.otherUser) {
    setThread(h('div', { class: 'thread' }, emptyPanel('Konuşma bulunamadı', 'Bu konuşma mevcut değil veya erişiminiz yok.')), null);
    return;
  }
  const other = conv.otherUser;
  setTitle(other.displayName);
  store.set({ activeThread: { scope: 'dm', id: conv.id, lastId: conv.lastMessage?.id ?? null } });
  const blocked = conv.blockedByMe;

  const toggleBlock = async () => {
    try {
      if (blocked) await api.del(`/api/users/${other.id}/block`);
      else {
        const ok = await confirmDialog({
          title: 'Üyeyi engelle',
          message: `${other.displayName} artık size özel mesaj gönderemeyecek ve siz de ona mesaj gönderemeyeceksiniz.`,
          confirmLabel: 'Engelle',
          danger: true,
        });
        if (!ok) return;
        await api.post(`/api/users/${other.id}/block`);
      }
      toast(blocked ? 'Engel kaldırıldı.' : 'Üye engellendi.', 'success');
      await refreshConversations();
      navigate(location.pathname, { replace: true });
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const head = h(
    'div',
    { class: 'chat-head' },
    toggleSideButton(),
    avatar(other, 36),
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'title' }, other.displayName, ' ', roleBadge(other.role)),
      h('div', { class: 'subtitle' }, `@${other.username} · ${other.online ? 'Çevrimiçi' : 'Çevrimdışı'}`),
    ),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => openUserCard(other.id) }, 'Profil'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: toggleBlock }, blocked ? 'Engeli kaldır' : 'Engelle'),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => openReportModal({ userId: other.id, label: other.displayName }) }, 'Şikayet'),
    ),
  );
  const thread = createThread({
    scope: 'dm',
    id: conv.id,
    canPost: !blocked,
    notice: blocked ? 'Bu kişiyi engellediniz. Mesaj göndermek için engeli kaldırmalısınız.' : null,
    composerNote: 'Engellenen kişilere mesaj gönderilemez.',
  });
  setThread(h('div', { class: 'thread', style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, head, thread.el), thread);
  thread.load().catch((err) => {
    if (isCurrent(renderId)) toast(errorText(err), 'error');
  });
}

/** Sohbet görünümü: /app, /app/room/:slug, /app/dm/:id */
export async function renderChat({ mode, slug, id }, renderId) {
  const main = mountShell('app', 'chat');
  ensureLayout(main);
  if (current) {
    current.destroy();
    current = null;
  }
  store.set({ activeThread: null });
  if (mode === 'room') await showRoom(slug, renderId);
  else if (mode === 'dm') await showDm(Number(id), renderId);
  else await showWelcome();
}

export function leaveChat() {
  if (current) current.destroy();
  current = null;
  layout = null;
}

// Gelen mesajları sidebar'daki sıralamaya yansıtmak için olayları dinle (store üzerinden).
on('revoked', () => {
  if (current) current.destroy();
  current = null;
});
