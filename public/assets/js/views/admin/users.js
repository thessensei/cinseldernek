import { api, withQuery } from '../../core/api.js';
import { debounce, h } from '../../core/dom.js';
import { formatShortDate, relativeTime } from '../../core/format.js';
import { isCurrent } from '../../core/router.js';
import { isAdmin, store } from '../../core/store.js';
import { adminFrame } from './frame.js';
import { avatar, errorText, formError, loading, pager, roleBadge, selectField, setFormError, statusBadge, table, textareaField } from '../../components/ui.js';
import { confirmDialog, openDialog, toast } from '../../components/feedback.js';

const ROLE_OPTIONS = [
  ['user', 'Üye'],
  ['moderator', 'Moderatör'],
  ['admin', 'Yönetici'],
];

function temporaryPasswordDialog(password) {
  const input = h('input', { class: 'input', value: password, readonly: true, 'aria-label': 'Geçici parola', onfocus: (e) => e.target.select() });
  const copy = h(
    'button',
    {
      class: 'btn btn-sm',
      type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(password);
          toast('Parola panoya kopyalandı.', 'success');
        } catch {
          input.select();
          toast('Kopyalanamadı; lütfen parolayı elle seçin.', 'warn');
        }
      },
    },
    'Kopyala',
  );
  let dialog;
  dialog = openDialog({
    title: 'Geçici parola oluşturuldu',
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted small' }, 'Parolayı kullanıcıya güvenli bir kanaldan iletin ve girişten sonra Profil sayfasından değiştirmesini isteyin. Bu pencere kapandığında parola bir daha gösterilmez.'),
      h('div', { class: 'row' }, input, copy),
    ),
    footer: h('button', { class: 'btn btn-primary', type: 'button', onclick: () => dialog.close() }, 'Tamam'),
  });
}

async function openUserDialog(userId, onChange) {
  let detail;
  try {
    detail = await api.get(`/api/admin/users/${userId}`);
  } catch (err) {
    toast(errorText(err), 'error');
    return;
  }
  const user = detail.user;
  const me = store.state.user;
  const admin = isAdmin(me);
  const self = user.id === me.id;
  const stats = detail.stats;
  let dialog;
  const close = () => dialog.close();
  const sections = [];

  sections.push(
    h(
      'div',
      { class: 'profile-head' },
      avatar(user, 56),
      h('div', { class: 'grow' }, h('div', { class: 'profile-name' }, user.displayName, ' ', roleBadge(user.role)), h('div', { class: 'muted small' }, `@${user.username}`), h('div', { class: 'row' }, statusBadge(user.status), user.online ? h('span', { class: 'badge badge-ok' }, 'Çevrimiçi') : null)),
    ),
    h(
      'dl',
      { class: 'kv' },
      h('dt', null, 'E-posta'), h('dd', null, user.email ?? 'Yalnızca yöneticiler görür'),
      h('dt', null, 'Destek alanı'), h('dd', null, user.helpArea ?? '—'),
      h('dt', null, 'Katılım'), h('dd', null, formatShortDate(user.createdAt)),
      h('dt', null, 'Son görülme'), h('dd', null, user.lastSeenAt ? relativeTime(user.lastSeenAt) : '—'),
      h('dt', null, 'İstatistik'), h('dd', null, `${stats.roomMessages} oda mesajı · ${stats.directMessages} özel mesaj · ${stats.posts} yazı`),
      h('dt', null, 'Şikayetler'), h('dd', null, `${stats.reportsAgainst} hakkında · ${stats.reportsFiled} yaptığı`),
    ),
  );

  if (user.status === 'banned' && user.banReason) {
    sections.push(h('div', { class: 'alert alert-danger' }, `Yasaklama sebebi: ${user.banReason}`));
  }

  if (admin && !self && user.status !== 'deleted') {
    const roleSelect = selectField({ label: 'Rol', name: 'role', options: ROLE_OPTIONS, value: user.role });
    const error = formError();
    const save = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, 'Rolü kaydet');
    save.addEventListener('click', async () => {
      if (roleSelect.input.value === user.role) return;
      save.disabled = true;
      try {
        await api.patch(`/api/admin/users/${user.id}`, { role: roleSelect.input.value });
        toast('Rol güncellendi.', 'success');
        close();
        onChange?.();
      } catch (err) {
        setFormError(error, errorText(err));
        save.disabled = false;
      }
    });
    sections.push(h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Rol'), roleSelect.wrap, error, h('div', { class: 'form-actions' }, save)));
  }

  if (!self && user.status !== 'deleted') {
    if (user.status === 'banned') {
      const unban = h('button', { class: 'btn btn-sm', type: 'button' }, 'Yasağı kaldır');
      unban.addEventListener('click', async () => {
        try {
          await api.patch(`/api/admin/users/${user.id}`, { status: 'active' });
          toast('Yasak kaldırıldı.', 'success');
          close();
          onChange?.();
        } catch (err) {
          toast(errorText(err), 'error');
        }
      });
      sections.push(h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Yasak'), h('p', { class: 'muted small' }, 'Hesap şu anda askıda. Yasağı kaldırırsanız üye tekrar giriş yapabilir.'), h('div', { class: 'form-actions' }, unban)));
    } else {
      const reason = textareaField({ label: 'Yasaklama sebebi (kullanıcı giriş ekranında görür)', name: 'banReason', rows: 2, maxlength: 300 });
      const ban = h('button', { class: 'btn btn-danger btn-sm', type: 'button' }, 'Kullanıcıyı yasakla');
      ban.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Kullanıcıyı yasakla',
          message: `${user.displayName} hemen çıkış yapılacak ve yeniden giriş yapamayacak. Devam edilsin mi?`,
          confirmLabel: 'Yasakla',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.patch(`/api/admin/users/${user.id}`, { status: 'banned', banReason: reason.input.value.trim() });
          toast('Kullanıcı yasaklandı.', 'success');
          close();
          onChange?.();
        } catch (err) {
          toast(errorText(err), 'error');
        }
      });
      sections.push(h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Yasakla'), reason.wrap, h('div', { class: 'form-actions' }, ban)));
    }
  }

  if (admin && !self && user.status !== 'deleted') {
    const reset = h('button', { class: 'btn btn-sm btn-danger', type: 'button' }, 'Parolayı sıfırla');
    reset.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Parolayı sıfırla',
        message: 'Yeni bir geçici parola oluşturulacak ve mevcut tüm oturumlar kapatılacak.',
        confirmLabel: 'Sıfırla',
        danger: true,
      });
      if (!ok) return;
      try {
        const { temporaryPassword } = await api.post(`/api/admin/users/${user.id}/reset-password`);
        close();
        temporaryPasswordDialog(temporaryPassword);
        onChange?.();
      } catch (err) {
        toast(errorText(err), 'error');
      }
    });
    sections.push(h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Parola'), h('p', { class: 'muted small' }, 'Üyenin parolasını unuttuğu durumlarda geçici parola oluşturun.'), h('div', { class: 'form-actions' }, reset)));
  }

  if (detail.recentReports.length) {
    sections.push(
      h(
        'section',
        { class: 'card' },
        h('h3', { class: 'card-title' }, 'Hakkındaki son şikayetler'),
        h(
          'div',
          { class: 'stack small' },
          detail.recentReports.map((report) =>
            h('div', { class: 'row-between' }, h('span', null, report.reason), h('span', { class: 'faint' }, `${report.status} · ${formatShortDate(report.createdAt)}`)),
          ),
        ),
      ),
    );
  }

  dialog = openDialog({
    title: 'Üye yönetimi',
    wide: true,
    body: h('div', { class: 'stack' }, sections),
    footer: h('button', { class: 'btn btn-ghost', type: 'button', onclick: close }, 'Kapat'),
  });
}

export async function renderUsers({ query, id }) {
  const content = adminFrame('users', 'Kullanıcılar');
  const state = {
    q: query.get('q') || '',
    role: query.get('role') || '',
    status: query.get('status') || '',
    page: 1,
    limit: 20,
  };
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Rumuz, görünen ad veya e-posta…', value: state.q, maxlength: 100, 'aria-label': 'Kullanıcı ara' });
  const roleFilter = h(
    'select',
    { class: 'select', 'aria-label': 'Rol filtresi' },
    [['', 'Tüm roller'], ...ROLE_OPTIONS].map(([value, label]) => h('option', { value, selected: value === state.role }, label)),
  );
  const statusFilter = h(
    'select',
    { class: 'select', 'aria-label': 'Durum filtresi' },
    [['', 'Aktif ve yasaklı'], ['active', 'Aktif'], ['banned', 'Yasaklı'], ['deleted', 'Silinmiş']].map(([value, label]) =>
      h('option', { value, selected: value === state.status }, label),
    ),
  );
  const tableHost = h('div', null, loading());
  const pagerHost = h('div');

  const columns = [
    {
      label: 'Üye',
      render: (user) =>
        h('div', { class: 'row' }, avatar(user, 30), h('div', null, h('div', null, user.displayName, ' ', roleBadge(user.role)), h('div', { class: 'faint small' }, `@${user.username}`))),
    },
    ...(isAdmin(store.state.user) ? [{ label: 'E-posta', className: 'wrap', render: (user) => user.email ?? '—' }] : []),
    { label: 'Durum', render: (user) => statusBadge(user.status) },
    { label: 'Son görülme', render: (user) => (user.online ? 'Çevrimiçi' : user.lastSeenAt ? relativeTime(user.lastSeenAt) : '—') },
    { label: 'Katılım', render: (user) => formatShortDate(user.createdAt) },
    {
      label: '',
      className: 'actions',
      render: (user) =>
        h('button', { class: 'btn btn-sm', type: 'button', onclick: (event) => { event.stopPropagation(); openUserDialog(user.id, load); } }, 'Yönet'),
    },
  ];

  async function load() {
    try {
      const data = await api.get(withQuery('/api/admin/users', { q: state.q, role: state.role, status: state.status, page: state.page, limit: state.limit }));
      if (!isCurrent(id)) return;
      tableHost.replaceChildren(
        table({ columns, rows: data.users, empty: 'Aranan kriterlere uygun üye bulunamadı.', onRowClick: (user) => openUserDialog(user.id, load) }),
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

  const applySearch = debounce(() => {
    state.q = search.value.trim();
    state.page = 1;
    load();
  }, 350);
  search.addEventListener('input', applySearch);
  roleFilter.addEventListener('change', () => {
    state.role = roleFilter.value;
    state.page = 1;
    load();
  });
  statusFilter.addEventListener('change', () => {
    state.status = statusFilter.value;
    state.page = 1;
    load();
  });

  content.replaceChildren(
    h('h1', null, 'Kullanıcılar'),
    h('p', { class: 'lead' }, 'Üyeleri ara, durumlarını yönet. Tüm yönetim işlemleri denetim kaydına yazılır.'),
    h('div', { class: 'toolbar-admin' }, search, roleFilter, statusFilter),
    tableHost,
    pagerHost,
  );
  await load();
}
