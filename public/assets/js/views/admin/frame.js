import { h } from '../../core/dom.js';
import { store } from '../../core/store.js';
import { mountShell, setTitle } from '../../components/layout.js';

const SECTIONS = [
  { key: 'dashboard', href: '/admin', label: 'Özet', roles: ['moderator', 'admin'] },
  { key: 'users', href: '/admin/users', label: 'Kullanıcılar', roles: ['moderator', 'admin'] },
  { key: 'posts', href: '/admin/posts', label: 'Blog', roles: ['moderator', 'admin'] },
  { key: 'reports', href: '/admin/reports', label: 'Şikayetler', roles: ['moderator', 'admin'], badge: true },
  { key: 'rooms', href: '/admin/rooms', label: 'Sohbet odaları', roles: ['admin'] },
  { key: 'audit', href: '/admin/audit', label: 'Denetim kaydı', roles: ['admin'] },
  { key: 'settings', href: '/admin/settings', label: 'Site ayarları', roles: ['admin'] },
];

/** Yönetim paneli kabuğu: yan menü + içerik alanı. İçerik düğümünü döndürür. */
export function adminFrame(active, title) {
  const main = mountShell('app', 'admin');
  const role = store.state.user?.role;
  const nav = h(
    'nav',
    { class: 'admin-nav', 'aria-label': 'Yönetim bölümleri' },
    h('div', { class: 'side-title' }, 'Yönetim'),
    SECTIONS.filter((item) => item.roles.includes(role)).map((item) =>
      h(
        'a',
        { href: item.href, 'aria-current': item.key === active ? 'page' : undefined },
        h('span', null, item.label),
        item.badge
          ? h('span', { class: 'badge badge-danger', 'data-admin-badge': 'reports', hidden: !store.state.reportsOpen }, String(store.state.reportsOpen || 0))
          : null,
      ),
    ),
  );
  const content = h('section', { class: 'admin-main' });
  main.replaceChildren(h('div', { class: 'admin' }, nav, content));
  setTitle(title ? `Yönetim · ${title}` : 'Yönetim');
  return content;
}

/** Şikayet sayacını tüm yönetim menülerinde canlı tutar. */
export function initAdminBadge() {
  store.subscribe((event) => {
    if (!(event.detail?.keys ?? []).includes('reportsOpen')) return;
    document.querySelectorAll('[data-admin-badge="reports"]').forEach((el) => {
      el.hidden = !store.state.reportsOpen;
      el.textContent = String(store.state.reportsOpen || 0);
    });
  });
}
