import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { formatShortDate, HELP_AREA_LABELS, ROLE_LABELS } from '../core/format.js';
import { currentRenderId, navigate, isCurrent } from '../core/router.js';
import { store } from '../core/store.js';
import { stopRealtime } from '../core/realtime.js';
import { mountShell, setTitle } from '../components/layout.js';
import { avatar, errorText, field, formError, loading, roleBadge, selectField, setFormError, textareaField } from '../components/ui.js';
import { AVATAR_COLORS } from '../components/palette.js';
import { openDialog, toast } from '../components/feedback.js';

function swatches(current, onPick) {
  return h(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': 'Avatar rengi' },
    AVATAR_COLORS.map((color) =>
      h(
        'label',
        { class: 'swatch', title: color },
        h('input', {
          type: 'radio',
          name: 'avatarColor',
          value: color,
          checked: color === current,
          onchange: () => onPick(color),
          'aria-label': color,
        }),
        h('span', { style: { background: color } }),
      ),
    ),
  );
}

function profileSection(me, reload) {
  const displayName = field({ label: 'Görünen ad', name: 'displayName', value: me.displayName, maxlength: 40, required: true });
  const bio = textareaField({ label: 'Biyografi', name: 'bio', value: me.bio || '', rows: 3, maxlength: 300, hint: 'Kendini kısaca tanıt (en fazla 300 karakter).' });
  let color = me.avatarColor;
  const preview = avatar({ ...me, avatarColor: color }, 64);
  const help = selectField({
    label: 'Destek alanı',
    name: 'helpArea',
    options: Object.entries(HELP_AREA_LABELS),
    value: me.helpArea || '',
    placeholder: 'Belirtmek istemiyorum',
  });
  const error = formError();
  const okBox = h('div', { class: 'form-ok', role: 'status' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Profili kaydet');
  const form = h(
    'form',
    { class: 'form' },
    h('div', { class: 'profile-head' }, preview, h('div', { class: 'grow' }, h('div', { class: 'profile-name' }, me.displayName), h('div', { class: 'muted small' }, `@${me.username}`))),
    h('div', { class: 'form-row' }, displayName.wrap, help.wrap),
    bio.wrap,
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Avatar rengi'), swatches(color, (picked) => {
      color = picked;
      preview.style.background = `linear-gradient(135deg, ${picked}, #c962ff)`;
    })),
    error,
    okBox,
    h('div', { class: 'form-actions' }, submit),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(error, '');
    okBox.textContent = '';
    submit.disabled = true;
    try {
      const { user } = await api.patch('/api/me', {
        displayName: displayName.input.value.trim(),
        bio: bio.input.value.trim(),
        avatarColor: color,
        helpArea: help.input.value || null,
      });
      store.set({ user: { ...store.state.user, ...user } });
      okBox.textContent = 'Profiliniz güncellendi.';
      toast('Profil kaydedildi.', 'success');
      reload?.();
    } catch (err) {
      setFormError(error, errorText(err));
    } finally {
      submit.disabled = false;
    }
  });
  return h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Profil bilgileri'), form);
}

function accountSection(me) {
  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title' }, 'Hesap'),
    h(
      'dl',
      { class: 'kv' },
      h('dt', null, 'Rumuz'), h('dd', null, `@${me.username}`),
      h('dt', null, 'E-posta'), h('dd', null, me.email),
      h('dt', null, 'Rol'), h('dd', null, roleBadge(me.role) ?? ROLE_LABELS.user),
      h('dt', null, 'Katılım'), h('dd', null, formatShortDate(me.createdAt)),
    ),
  );
}

function passwordSection() {
  const current = field({ label: 'Mevcut parola', name: 'currentPassword', type: 'password', required: true, autocomplete: 'current-password' });
  const next = field({ label: 'Yeni parola', name: 'newPassword', type: 'password', required: true, minlength: 8, autocomplete: 'new-password', hint: 'En az 8 karakter.' });
  const error = formError();
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Parolayı değiştir');
  const form = h('form', { class: 'form' }, current.wrap, next.wrap, error, h('div', { class: 'form-actions' }, submit));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(error, '');
    submit.disabled = true;
    try {
      await api.post('/api/me/password', { currentPassword: current.input.value, newPassword: next.input.value });
      form.reset();
      toast('Parolanız güncellendi. Diğer oturumlar kapatıldı.', 'success');
    } catch (err) {
      setFormError(error, errorText(err));
    } finally {
      submit.disabled = false;
    }
  });
  return h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Parola'), form);
}

function blocksSection(load) {
  const list = h('div', { class: 'stack' }, loading('Yükleniyor…'));
  const fill = async () => {
    try {
      const { users } = await api.get('/api/me/blocks');
      list.replaceChildren(
        ...(users.length
          ? users.map((user) =>
              h(
                'div',
                { class: 'user-chip row-between' },
                h('span', { class: 'row' }, avatar(user, 30), h('span', null, user.displayName), h('span', { class: 'faint small' }, `@${user.username}`)),
                h('button', {
                  class: 'btn btn-sm',
                  type: 'button',
                  onclick: async () => {
                    try {
                      await api.del(`/api/users/${user.id}/block`);
                      toast('Engel kaldırıldı.', 'success');
                      fill();
                    } catch (err) {
                      toast(errorText(err), 'error');
                    }
                  },
                }, 'Engeli kaldır'),
              ),
            )
          : [h('p', { class: 'faint small' }, 'Engellediğiniz kimse yok.')]),
      );
    } catch (err) {
      list.replaceChildren(h('p', { class: 'form-error' }, errorText(err)));
    }
  };
  fill();
  return h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Engellenen üyeler'), list);
}

function deleteSection() {
  return h(
    'section',
    { class: 'card', style: { borderColor: 'rgba(255,82,82,0.35)' } },
    h('h2', { class: 'card-title' }, 'Hesabımı sil'),
    h('p', { class: 'muted small' }, 'Hesabınızı silerseniz oturumunuz kapanır, mesajlarınızın içeriği temizlenir ve rumuzunuz geri alınamaz şekilde anonimleştirilir.'),
    h(
      'div',
      { style: { marginTop: '0.9rem' } },
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        onclick: () => openDeleteDialog(),
      }, 'Hesabımı kalıcı olarak sil'),
    ),
  );
}

function openDeleteDialog() {
  const password = field({ label: 'Onay için parolanız', name: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  const error = formError();
  const confirm = h('button', { class: 'btn btn-danger', type: 'button' }, 'Hesabımı sil');
  let dialog;
  confirm.addEventListener('click', async () => {
    setFormError(error, '');
    confirm.disabled = true;
    try {
      await api.post('/api/me/delete', { password: password.input.value });
      dialog.close();
      store.set({ user: null, rooms: [], conversations: [], online: new Set() });
      stopRealtime();
      toast('Hesabınız silindi. Bizimle olduğun için teşekkürler.', 'success');
      navigate('/', { replace: true });
    } catch (err) {
      setFormError(error, errorText(err));
      confirm.disabled = false;
    }
  });
  dialog = openDialog({
    title: 'Hesabı sil',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Bu işlem geri alınamaz. Devam etmek için parolanızı girin.'), password.wrap, error),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dialog.close() }, 'Vazgeç'), confirm],
  });
}

export async function renderProfile({ id }) {
  const main = mountShell('app', 'profile');
  setTitle('Profilim');
  main.replaceChildren(h('div', { class: 'page-narrow' }, loading()));
  let me;
  try {
    ({ user: me } = await api.get('/api/auth/me'));
  } catch (err) {
    toast(errorText(err), 'error');
    return;
  }
  if (!isCurrent(id) || !me) return;
  store.set({ user: { ...store.state.user, ...me } });
  const rerender = () => renderProfile({ id: currentRenderId() });
  main.replaceChildren(
    h(
      'div',
      { class: 'page-narrow' },
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Profilim'), h('p', null, 'Bilgilerini düzenle, güvenliğini yönet.'))),
      h('div', { class: 'two-col' }, h('div', { class: 'stack' }, profileSection(me, rerender), passwordSection()), h('div', { class: 'stack' }, accountSection(me), blocksSection(), deleteSection())),
    ),
  );
}
