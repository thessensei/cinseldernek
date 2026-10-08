import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { navigate } from '../core/router.js';
import { store, isStaff } from '../core/store.js';
import { stopRealtime } from '../core/realtime.js';
import { toast } from './feedback.js';
import { avatar, roleBadge } from './ui.js';

const WS_LABEL = { online: 'Canlı', connecting: 'Bağlanıyor', reconnecting: 'Yeniden bağlanıyor', offline: 'Çevrimdışı', idle: '' };
const SITE = 'SPEKTRUM';

let shell = null;

export function setTitle(part) {
  document.title = part ? `${part} · ${SITE}` : `${SITE} — Herkes İçin Yüksek Testesteron Seviyesi`;
}

function navLink(href, label, key, active, extra) {
  return h('a', { href, 'aria-current': key === active ? 'page' : undefined }, label, extra ?? null);
}

function badge(slot) {
  return h('span', { class: 'badge badge-unread', 'data-slot': slot, hidden: true });
}

async function logout() {
  try {
    await api.post('/api/auth/logout');
  } catch {
    // Oturum zaten kapanmış olabilir.
  }
  stopRealtime();
  store.set({ user: null, rooms: [], conversations: [], online: new Set(), reportsOpen: 0 });
  toast('Çıkış yaptınız. Görüşmek üzere!', 'success');
  navigate('/');
}

function userChip(user) {
  return h(
    'a',
    { class: 'user-chip', href: '/profile', title: 'Profilim' },
    avatar(user, 30),
    h('span', { class: 'name truncate' }, user.displayName),
    roleBadge(user.role),
  );
}

function buildHeader(kind, active) {
  const user = store.state.user;
  if (kind === 'public') {
    const right = user
      ? h('div', { class: 'topbar-right' }, navLink('/app', 'Sohbet', 'chat', active), userChip(user), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: logout }, 'Çıkış'))
      : h(
          'div',
          { class: 'topbar-right' },
          h('a', { class: 'btn btn-sm btn-ghost', href: '/login' }, 'Giriş'),
          h('a', { class: 'btn btn-sm btn-primary', href: '/register' }, 'Katıl'),
        );
    return h(
      'header',
      { class: 'topbar' },
      brand(user ? '/app' : '/'),
      h('nav', { class: 'nav', 'aria-label': 'Site gezinmesi' }, navLink('/blog', 'Blog', 'blog', active)),
      right,
    );
  }

  const staff = isStaff(user);
  return h(
    'header',
    { class: 'topbar' },
    brand('/app'),
    h(
      'nav',
      { class: 'nav', 'aria-label': 'Ana gezinme' },
      navLink('/app', 'Sohbet', 'chat', active, badge('chat')),
      navLink('/blog', 'Blog', 'blog', active),
      navLink('/profile', 'Profil', 'profile', active),
      staff ? navLink('/admin', 'Yönetim', 'admin', active, badge('reports')) : null,
    ),
    h(
      'div',
      { class: 'topbar-right' },
      h('span', { class: 'ws-status', 'data-slot': 'ws', 'data-state': 'idle' }, ''),
      userChip(user),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: logout }, 'Çıkış'),
    ),
  );
}

function brand(href) {
  return h(
    'a',
    { class: 'brand', href, 'aria-label': 'SPEKTRUM ana sayfa' },
    h('span', { class: 'brand-name' }, SITE),
    h('span', { class: 'brand-tag' }, 'Herkes İçin Yüksek Testesteron Seviyesi'),
  );
}

function footer() {
  return h(
    'footer',
    { class: 'site-footer' },
    '© 2026 Spektrum Dayanışma Ağı · Tüm kimlikler onurludur 🏳️‍⚧️🏳️‍🌈 · thessensei',
  );
}

/** Kabuğu (üst çubuk + sayfa alanı) kurar veya mevcut olanı yeniden kullanır. */
export function mountShell(kind, active) {
  const user = store.state.user;
  const key = `${kind}:${user ? `${user.id}:${user.role}` : 'guest'}`;
  const app = document.getElementById('app');
  if (!shell || shell.key !== key) {
    app.replaceChildren();
    app.className = `app-root app-${kind}`;
    const header = buildHeader(kind, active);
    const main = h('main', { class: 'page', id: 'page', tabindex: '-1' });
    const parts = [header, h('div', { class: 'pride-bar' }), main];
    if (kind === 'public') parts.push(footer());
    app.append(...parts);
    shell = { key, kind, app, header, main, active };
    if (kind === 'app' || kind === 'admin') app.classList.add('app-shell');
  }
  shell.active = active;
  app.dataset.view = active;
  shell.header.querySelectorAll('.nav a').forEach((link) => {
    const isActive = link.getAttribute('href') === hrefFor(active);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  renderAnnouncement();
  updateChrome();
  return shell.main;
}

function hrefFor(active) {
  return { chat: '/app', blog: '/blog', profile: '/profile', admin: '/admin', home: '/' }[active];
}

function renderAnnouncement() {
  const text = store.state.settings?.announcement ?? '';
  const existing = document.getElementById('announcement');
  if (!text) {
    existing?.remove();
    return;
  }
  const node = h('div', { class: 'announcement', id: 'announcement', role: 'region', 'aria-label': 'Duyuru' }, h('strong', null, 'Duyuru:'), ` ${text}`);
  if (existing) existing.replaceWith(node);
  else shell.app.prepend(node);
}

/** Üst çubuk rozetlerini ve bağlantı durumunu günceller. */
export function updateChrome() {
  if (!shell) return;
  const { wsStatus, unreadRooms, unreadDms, reportsOpen } = store.state;
  const ws = shell.header.querySelector('[data-slot="ws"]');
  if (ws) {
    ws.dataset.state = wsStatus;
    ws.textContent = WS_LABEL[wsStatus] ?? '';
    ws.hidden = !store.state.user;
  }
  const chat = shell.header.querySelector('[data-slot="chat"]');
  if (chat) {
    const total = (unreadRooms || 0) + (unreadDms || 0);
    chat.hidden = total === 0;
    chat.textContent = total > 99 ? '99+' : String(total);
  }
  const reports = shell.header.querySelector('[data-slot="reports"]');
  if (reports) {
    reports.hidden = !reportsOpen;
    reports.textContent = String(reportsOpen || 0);
  }
}

store.subscribe((event) => {
  const keys = event.detail?.keys ?? [];
  if (keys.some((key) => ['wsStatus', 'unreadRooms', 'unreadDms', 'reportsOpen', 'settings', 'user'].includes(key))) {
    if (keys.includes('settings')) renderAnnouncement();
    updateChrome();
  }
});
