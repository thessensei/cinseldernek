import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { REPORT_REASON_LABELS, ROLE_LABELS, relativeTime, formatShortDate } from '../../core/format.js';
import { isCurrent } from '../../core/router.js';
import { adminFrame } from './frame.js';
import { avatar, errorText, formatCount, loading, roleBadge, statusBadge, table } from '../../components/ui.js';

function statCard(label, value, sub, href) {
  const body = [
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, formatCount(value)),
    sub ? h('div', { class: 'stat-sub' }, sub) : null,
  ];
  return href
    ? h('a', { class: 'stat-card', href, style: { display: 'block', color: 'inherit' } }, body)
    : h('div', { class: 'stat-card' }, body);
}

export async function renderDashboard({ id }) {
  const content = adminFrame('dashboard', 'Özet');
  content.replaceChildren(h('h1', null, 'Özet'), h('p', { class: 'lead' }, 'Topluluğun anlık durumu.'), loading());
  let data;
  try {
    data = await api.get('/api/admin/stats');
  } catch (err) {
    if (isCurrent(id)) content.replaceChildren(h('h1', null, 'Özet'), h('p', { class: 'form-error' }, errorText(err)));
    return;
  }
  if (!isCurrent(id)) return;

  const recentReports = data.recentReports.length
    ? h(
        'div',
        { class: 'stack' },
        data.recentReports.map((report) =>
          h(
            'a',
            { class: 'user-chip row-between', href: '/admin/reports' },
            h('span', null, REPORT_REASON_LABELS[report.reason] ?? report.reason),
            h('span', { class: 'faint small' }, relativeTime(report.createdAt)),
          ),
        ),
      )
    : h('p', { class: 'faint small' }, 'Açık şikayet yok. 🎉');

  content.replaceChildren(
    h('h1', null, 'Özet'),
    h('p', { class: 'lead' }, 'Topluluğun anlık durumu ve bekleyen işler.'),
    h(
      'div',
      { class: 'stats-grid' },
      statCard('Üyeler', data.users.total, `${data.users.active} aktif · ${data.users.banned} yasaklı`),
      statCard('Çevrimiçi', data.onlineNow, 'şu anda bağlı'),
      statCard('Bugünkü mesajlar', data.messages.today, `toplam ${formatCount(data.messages.total)} · ${formatCount(data.messages.direct)} özel`),
      statCard('Açık şikayetler', data.reports.open, 'incelenmeyi bekliyor', '/admin/reports'),
      statCard('Yayınlanan yazılar', data.posts.published, `${data.posts.draft} taslak`, '/admin/posts'),
      statCard('Sohbet odaları', data.rooms, 'oda'),
      statCard('Bugün katılan', data.users.newToday, 'yeni üye'),
      statCard('Ekip', data.users.staff, 'moderatör ve yönetici'),
    ),
    h(
      'div',
      { class: 'two-col' },
      h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Son açık şikayetler'), recentReports),
      h(
        'section',
        { class: 'card', style: { padding: '1rem' } },
        h('h2', { class: 'card-title', style: { padding: '0.4rem 0.5rem' } }, 'Yeni üyeler'),
        table({
          columns: [
            {
              label: 'Üye',
              render: (user) =>
                h('div', { class: 'row' }, avatar(user, 28), h('div', null, h('div', null, user.displayName), h('div', { class: 'faint small' }, `@${user.username}`))),
            },
            { label: 'Rol', render: (user) => roleBadge(user.role) ?? h('span', { class: 'faint' }, ROLE_LABELS.user) },
            { label: 'Durum', render: (user) => statusBadge(user.status) },
            { label: 'Katılım', render: (user) => formatShortDate(user.createdAt) },
          ],
          rows: data.recentUsers,
          empty: 'Henüz üye yok.',
        }),
      ),
    ),
  );
}
