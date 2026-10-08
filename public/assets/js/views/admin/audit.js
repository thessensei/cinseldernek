import { api, withQuery } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { formatDateTime } from '../../core/format.js';
import { isCurrent } from '../../core/router.js';
import { adminFrame } from './frame.js';
import { errorText, loading, pager, table } from '../../components/ui.js';

const ACTIONS = {
  'user.banned': 'Kullanıcı yasaklandı',
  'user.unbanned': 'Yasak kaldırıldı',
  'user.role_changed': 'Rol değiştirildi',
  'user.password_reset': 'Parola sıfırlandı',
  'user.self_deleted': 'Hesap silindi',
  'report.resolved': 'Şikayet sonuçlandı',
  'message.deleted_by_mod': 'Mesaj moderatör tarafından silindi',
  'comment.deleted_by_mod': 'Yorum moderatör tarafından silindi',
  'post.created': 'Yazı oluşturuldu',
  'post.updated': 'Yazı güncellendi',
  'post.deleted': 'Yazı silindi',
  'room.created': 'Oda oluşturuldu',
  'room.updated': 'Oda güncellendi',
  'room.deleted': 'Oda silindi',
  'settings.updated': 'Site ayarları güncellendi',
};

export async function renderAudit({ query, id }) {
  const content = adminFrame('audit', 'Denetim kaydı');
  const state = { page: Number(query.get('page')) || 1, limit: 25 };
  const tableHost = h('div', null, loading());
  const pagerHost = h('div');

  async function load() {
    try {
      const data = await api.get(withQuery('/api/admin/audit', { page: state.page, limit: state.limit }));
      if (!isCurrent(id)) return;
      tableHost.replaceChildren(
        table({
          columns: [
            { label: 'Zaman', render: (log) => formatDateTime(log.createdAt) },
            { label: 'Yapan', render: (log) => (log.actor ? `@${log.actor.username}` : 'Sistem') },
            { label: 'Eylem', render: (log) => ACTIONS[log.action] ?? log.action },
            { label: 'Hedef', render: (log) => (log.targetType ? `${log.targetType} #${log.targetId}` : '—') },
            {
              label: 'Ayrıntı',
              className: 'wrap',
              render: (log) => h('pre', { class: 'json' }, Object.keys(log.details || {}).length ? JSON.stringify(log.details, null, 0) : '—'),
            },
          ],
          rows: data.logs,
          empty: 'Henüz denetim kaydı yok.',
        }),
      );
      pagerHost.replaceChildren(
        pager({
          page: state.page,
          limit: state.limit,
          total: data.total,
          onChange: (page) => {
            state.page = page;
            load();
          },
        }),
      );
    } catch (err) {
      tableHost.replaceChildren(h('p', { class: 'form-error' }, errorText(err)));
    }
  }

  content.replaceChildren(
    h('h1', null, 'Denetim kaydı'),
    h('p', { class: 'lead' }, 'Yönetici ve moderatör eylemlerinin değiştirilemez günlüğü.'),
    tableHost,
    pagerHost,
  );
  await load();
}
