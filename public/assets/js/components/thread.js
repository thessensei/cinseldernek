import { api, withQuery } from '../core/api.js';
import { h, linkify } from '../core/dom.js';
import { dayKey, dayLabel, formatTime } from '../core/format.js';
import { on, store, isStaff } from '../core/store.js';
import { sendTyping } from '../core/realtime.js';
import { markRead } from '../core/sync.js';
import { avatar, errorText, roleBadge } from './ui.js';
import { confirmDialog, toast } from './feedback.js';
import { openReportModal, openUserCard } from './usercard.js';

const PAGE = 50;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const MAX_LENGTH = 2000;

/**
 * Oda veya özel konuşma için mesaj akışı + yazma alanı.
 * Canlı olaylar (message, typing, resync/poll) bu bileşen tarafından dinlenir.
 */
export function createThread({ scope, id, canPost = true, notice = null, composerNote = '' }) {
  const base = scope === 'room' ? `/api/rooms/${id}` : `/api/dms/${id}`;
  const messages = new Map();
  const typers = new Map();
  const unsubscribers = [];
  let oldestId = null;
  let newestId = null;
  let hasOlder = false;
  let loadingOlder = false;
  let sending = false;
  let destroyed = false;
  let editingId = null;
  let editDraft = null;
  let lastMarked = 0;

  /* ----- DOM ----- */
  const scroller = h('div', { class: 'thread-scroll', role: 'log', 'aria-live': 'polite', 'aria-label': 'Mesajlar' });
  const topNote = h('div', { class: 'thread-top' });
  const list = h('div', { class: 'thread-list' });
  scroller.append(topNote, list);
  // Dokunmatik cihazlarda mesaj eylemleri, mesaja dokununca görünür (üzerine gelme yok).
  list.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const article = target?.closest('.msg');
    if (!article || target.closest('button, a, textarea, input') || !article.querySelector('.msg-actions')) return;
    const wasOpen = article.classList.contains('show-actions');
    list.querySelectorAll('.msg.show-actions').forEach((el) => el.classList.remove('show-actions'));
    if (!wasOpen) article.classList.add('show-actions');
  });
  const typingEl = h('div', { class: 'typing', 'aria-live': 'polite' });
  const errorEl = h('span', { class: 'error', role: 'alert' });
  const counter = h('span', null, '');
  const textarea = h('textarea', {
    rows: 1,
    maxlength: MAX_LENGTH,
    placeholder: 'Mesaj yaz…',
    title: 'Enter gönderir · Shift+Enter yeni satır',
    'aria-label': 'Mesaj yaz',
  });
  const sendButton = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Gönder');
  const composerForm = h('form', { class: 'composer' }, textarea, sendButton);
  const composer = h(
    'div',
    { class: 'composer-wrap' },
    canPost
      ? [composerForm, h('div', { class: 'composer-meta' }, errorEl, counter)]
      : h('div', { class: 'composer-disabled' }, composerNote || 'Bu konuşmaya şu anda mesaj gönderemezsiniz.'),
  );
  const root = h(
    'section',
    { class: 'thread' },
    notice ? h('div', { class: 'alert thread-notice' }, notice) : null,
    scroller,
    typingEl,
    composer,
  );

  /* ----- Yardımcılar ----- */
  const me = () => store.state.user;
  const isNearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
  const scrollToBottom = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };
  const sorted = () => [...messages.values()].sort((a, b) => a.id - b.id);

  function updateCounter() {
    counter.textContent = textarea.value.length > MAX_LENGTH * 0.8 ? `${textarea.value.length}/${MAX_LENGTH}` : '';
  }

  function autosize() {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }

  /* ----- Mesaj düğümü ----- */
  function messageNode(msg, grouped) {
    const mine = msg.author?.id === me()?.id;
    const canEdit = mine && !msg.deleted;
    const canDelete = !msg.deleted && (mine || (scope === 'room' && isStaff(me())));
    const canReport = !msg.deleted && !mine && msg.author;

    const actions = [];
    if (canEdit) actions.push(h('button', { type: 'button', onclick: () => startEdit(msg.id) }, 'Düzenle'));
    if (canDelete) actions.push(h('button', { type: 'button', class: 'danger', onclick: () => removeMessage(msg) }, 'Sil'));
    if (canReport) {
      actions.push(
        h('button', { type: 'button', onclick: () => openReportModal({ messageId: msg.id }) }, 'Şikayet et'),
      );
    }

    const nameNode = msg.author
      ? h('button', { type: 'button', class: 'msg-name', onclick: () => (mine ? null : openUserCard(msg.author.id)) }, msg.author.displayName)
      : h('span', { class: 'msg-name' }, 'Silinmiş üye');

    const head = h(
      'div',
      { class: 'msg-head' },
      nameNode,
      roleBadge(msg.author?.role),
      h('time', { class: 'msg-time', datetime: msg.createdAt }, formatTime(msg.createdAt)),
      msg.editedAt ? h('span', { class: 'msg-edited' }, '(düzenlendi)') : null,
    );

    let content;
    if (editingId === msg.id) content = editor(msg);
    else if (msg.deleted) content = h('p', { class: 'msg-deleted' }, 'Bu mesaj silindi.');
    else content = h('p', { class: 'msg-text' }, linkify(msg.body));

    return h(
      'article',
      { class: `msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`, 'data-id': msg.id },
      h('div', { class: 'avatar-slot' }, msg.author ? avatar(msg.author, 36) : avatar({ displayName: '?' }, 36)),
      h(
        'div',
        { class: 'msg-content' },
        grouped ? null : head,
        content,
        actions.length && editingId !== msg.id ? h('div', { class: 'msg-actions' }, actions) : null,
      ),
    );
  }

  function editor(msg) {
    const area = h('textarea', { class: 'textarea', rows: 2, maxlength: MAX_LENGTH, 'aria-label': 'Mesajı düzenle' });
    area.value = editDraft ?? msg.body;
    area.addEventListener('input', () => {
      editDraft = area.value;
    });
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        saveEdit(msg.id, area.value);
      }
      if (event.key === 'Escape') cancelEdit();
    });
    queueMicrotask(() => {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
    return h(
      'div',
      { class: 'msg-edit' },
      area,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => saveEdit(msg.id, area.value) }, 'Kaydet'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: cancelEdit }, 'Vazgeç'),
        h('span', { class: 'faint small' }, 'Enter kaydeder · Esc iptal'),
      ),
    );
  }

  function render({ anchor = 'keep', previousHeight = 0, previousTop = 0 } = {}) {
    if (destroyed) return;
    const stick = anchor === 'bottom' || (anchor === 'auto' && isNearBottom());
    const items = sorted();
    const fragment = document.createDocumentFragment();
    if (!items.length) {
      fragment.append(h('div', { class: 'empty' }, scope === 'room' ? 'Bu odada henüz mesaj yok. İlk mesajı sen yaz!' : 'Henüz mesaj yok. Konuşmayı başlatın!'));
    }
    let previous = null;
    for (const msg of items) {
      if (!previous || dayKey(previous.createdAt) !== dayKey(msg.createdAt)) {
        fragment.append(h('div', { class: 'day-divider' }, dayLabel(msg.createdAt)));
      }
      const grouped = Boolean(
        previous &&
          previous.author && msg.author &&
          previous.author.id === msg.author.id &&
          !previous.deleted && !msg.deleted &&
          dayKey(previous.createdAt) === dayKey(msg.createdAt) &&
          new Date(msg.createdAt) - new Date(previous.createdAt) < GROUP_WINDOW_MS,
      );
      fragment.append(messageNode(msg, grouped));
      previous = msg;
    }
    list.replaceChildren(fragment);
    topNote.textContent = hasOlder ? 'Daha eski mesajlar için yukarı kaydırın' : items.length ? 'Konuşmanın başı' : '';
    if (anchor === 'prepend') scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
    else if (stick) scrollToBottom();
    else scroller.scrollTop = previousTop;
  }

  function renderTyping() {
    const names = [...typers.values()].map((t) => t.name);
    if (!names.length) {
      typingEl.textContent = '';
      return;
    }
    const label = names.length === 1 ? `${names[0]} yazıyor…` : `${names.slice(0, 2).join(' ve ')} yazıyor…`;
    typingEl.textContent = label;
  }

  function upsert(message, { anchor = 'auto' } = {}) {
    const stick = anchor === 'bottom' || (anchor === 'auto' && isNearBottom());
    messages.set(message.id, message);
    if (newestId == null || message.id > newestId) newestId = message.id;
    if (oldestId == null || message.id < oldestId) oldestId = message.id;
    if (store.state.activeThread && store.state.activeThread.scope === scope && store.state.activeThread.id === id) {
      store.state.activeThread.lastId = newestId;
    }
    render({ anchor: stick ? 'bottom' : 'keep', previousTop: scroller.scrollTop });
  }

  function markReadNow() {
    if (!newestId || newestId <= lastMarked || document.visibilityState !== 'visible') return;
    lastMarked = newestId;
    markRead(scope, id, newestId).catch(() => {});
  }

  /* ----- Veri ----- */
  async function loadLatest() {
    const data = await api.get(withQuery(`${base}/messages`, { limit: PAGE }));
    for (const msg of data.messages) messages.set(msg.id, msg);
    hasOlder = data.hasMore;
    oldestId = data.messages[0]?.id ?? null;
    newestId = data.messages.at(-1)?.id ?? null;
    store.set({ activeThread: { scope, id, lastId: newestId } });
    render({ anchor: 'bottom' });
    markReadNow();
    return data;
  }

  async function loadOlder() {
    if (loadingOlder || !hasOlder || oldestId == null || destroyed) return;
    loadingOlder = true;
    topNote.textContent = 'Eski mesajlar yükleniyor…';
    const previousHeight = scroller.scrollHeight;
    const previousTop = scroller.scrollTop;
    try {
      const data = await api.get(withQuery(`${base}/messages`, { before: oldestId, limit: PAGE }));
      for (const msg of data.messages) messages.set(msg.id, msg);
      hasOlder = data.hasMore;
      if (data.messages.length) oldestId = data.messages[0].id;
      render({ anchor: 'prepend', previousHeight, previousTop });
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      loadingOlder = false;
    }
  }

  async function catchUp() {
    if (destroyed || newestId == null) return;
    try {
      const data = await api.get(withQuery(`${base}/messages`, { after: newestId, limit: 100 }));
      if (!data.messages.length) return;
      for (const msg of data.messages) messages.set(msg.id, msg);
      newestId = data.messages.at(-1).id;
      render({ anchor: 'auto', previousTop: scroller.scrollTop });
      markReadNow();
    } catch {
      // Bir sonraki yoklamada tekrar denenir.
    }
  }

  /* ----- Eylemler ----- */
  function startEdit(msgId) {
    editingId = msgId;
    editDraft = null;
    render({ anchor: 'keep', previousTop: scroller.scrollTop });
  }

  function cancelEdit() {
    editingId = null;
    editDraft = null;
    render({ anchor: 'keep', previousTop: scroller.scrollTop });
  }

  async function saveEdit(msgId, value) {
    const body = value.trim();
    if (!body) {
      toast('Mesaj boş olamaz.', 'error');
      return;
    }
    try {
      const { message } = await api.patch(`/api/messages/${msgId}`, { body });
      messages.set(message.id, message);
      editingId = null;
      editDraft = null;
      render({ anchor: 'keep', previousTop: scroller.scrollTop });
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function removeMessage(msg) {
    const ok = await confirmDialog({
      title: 'Mesajı sil',
      message: 'Bu mesaj herkes için silinecek. Bu işlem geri alınamaz.',
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/messages/${msg.id}`);
      messages.set(msg.id, { ...msg, deleted: true, body: '' });
      render({ anchor: 'keep', previousTop: scroller.scrollTop });
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function send(event) {
    event.preventDefault();
    const body = textarea.value.replace(/\r\n?/g, '\n').trim();
    if (!body || sending) return;
    if (body.length > MAX_LENGTH) {
      errorEl.textContent = `Mesaj en fazla ${MAX_LENGTH} karakter olabilir.`;
      return;
    }
    sending = true;
    sendButton.disabled = true;
    errorEl.textContent = '';
    try {
      const path = scope === 'room' ? `/api/rooms/${id}/messages` : `/api/dms/${id}/messages`;
      const { message } = await api.post(path, { body });
      textarea.value = '';
      autosize();
      updateCounter();
      sendTyping(scope, id, false);
      upsert(message, { anchor: 'bottom' });
      lastMarked = Math.max(lastMarked, message.id);
    } catch (err) {
      errorEl.textContent = errorText(err);
    } finally {
      sending = false;
      sendButton.disabled = false;
      textarea.focus();
    }
  }

  /* ----- Olay bağlantıları ----- */
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      composerForm.requestSubmit();
    }
  });
  textarea.addEventListener('input', () => {
    autosize();
    updateCounter();
    if (textarea.value.trim()) sendTyping(scope, id, true);
  });
  textarea.addEventListener('blur', () => sendTyping(scope, id, false));
  composerForm.addEventListener('submit', send);
  scroller.addEventListener('scroll', () => {
    if (scroller.scrollTop < 120 && hasOlder) loadOlder();
  });

  const onVisibility = () => {
    if (document.visibilityState === 'visible') markReadNow();
  };
  document.addEventListener('visibilitychange', onVisibility);

  unsubscribers.push(
    on('message', (event) => {
      if (destroyed) return;
      const { type, message } = event.detail;
      const matches = scope === 'room' ? message.roomId === id : message.conversationId === id;
      if (!matches) return;
      if (type === 'message:new') {
        typers.delete(message.author?.id);
        renderTyping();
        const mine = message.author?.id === me()?.id;
        upsert(message, { anchor: mine ? 'bottom' : 'auto' });
        markReadNow();
      } else if (messages.has(message.id)) {
        messages.set(message.id, message);
        render({ anchor: 'keep', previousTop: scroller.scrollTop });
      }
    }),
    on('typing', (event) => {
      if (destroyed) return;
      const data = event.detail;
      if (data.scope !== scope || data.id !== id) return;
      if (data.user.id === me()?.id) return;
      if (data.typing) {
        clearTimeout(typers.get(data.user.id)?.timer);
        const timer = setTimeout(() => {
          typers.delete(data.user.id);
          renderTyping();
        }, 4000);
        typers.set(data.user.id, { name: data.user.displayName, timer });
      } else {
        clearTimeout(typers.get(data.user.id)?.timer);
        typers.delete(data.user.id);
      }
      renderTyping();
    }),
    on('resync', () => catchUp()),
    on('poll', () => catchUp()),
  );

  function destroy() {
    destroyed = true;
    unsubscribers.forEach((off) => off());
    document.removeEventListener('visibilitychange', onVisibility);
    for (const typer of typers.values()) clearTimeout(typer.timer);
    typers.clear();
    sendTyping(scope, id, false);
    if (store.state.activeThread?.scope === scope && store.state.activeThread?.id === id) {
      store.set({ activeThread: null });
    }
  }

  autosize();
  updateCounter();
  return { el: root, load: loadLatest, destroy, focus: () => textarea.focus() };
}
