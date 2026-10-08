import { api, withQuery } from '../core/api.js';
import { h } from '../core/dom.js';
import { formatShortDate, HELP_AREA_LABELS, REPORT_REASON_LABELS } from '../core/format.js';
import { navigate } from '../core/router.js';
import { store, isStaff } from '../core/store.js';
import { refreshConversations } from '../core/sync.js';
import { openDialog, toast } from './feedback.js';
import { avatar, errorText, field, formError, roleBadge, selectField, setFormError, textareaField } from './ui.js';

/** Şikayet penceresi. Mesaj veya kullanıcı için açılabilir. */
export function openReportModal({ messageId = null, userId = null, label = '' }) {
  const reasonOptions = Object.entries(REPORT_REASON_LABELS);
  const reason = selectField({ label: 'Şikayet nedeni', name: 'reason', options: reasonOptions, value: 'taciz', required: true });
  const details = textareaField({
    label: 'Açıklama (isteğe bağlı)',
    name: 'details',
    rows: 3,
    maxlength: 1000,
    placeholder: 'Ne oldu? Moderatörlerin inceleyebilmesi için kısaca anlatın.',
  });
  const error = formError();
  const submit = h('button', { class: 'btn btn-danger', type: 'button' }, 'Şikayet gönder');
  const form = h(
    'form',
    { class: 'form' },
    h('p', { class: 'muted small' }, messageId ? 'Bu mesajı moderatörlere bildiriyorsunuz. Şikayetler gizli tutulur.' : `${label} adlı üyeyi moderatörlere bildiriyorsunuz.`),
    reason.wrap,
    details.wrap,
    error,
  );
  let dialog;
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    setFormError(error, '');
    try {
      await api.post('/api/reports', {
        reason: reason.input.value,
        details: details.input.value.trim(),
        ...(messageId ? { messageId } : { userId }),
      });
      toast('Şikayetiniz moderatörlere iletildi. Teşekkürler.', 'success');
      dialog.close();
    } catch (err) {
      setFormError(error, errorText(err));
      submit.disabled = false;
    }
  });
  dialog = openDialog({
    title: messageId ? 'Mesajı şikayet et' : 'Üyeyi şikayet et',
    body: form,
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dialog.close() }, 'Vazgeç'),
      submit,
    ],
  });
  return dialog;
}

async function startDirectMessage(userId, dialog) {
  try {
    const { conversation } = await api.post('/api/dms', { userId });
    dialog?.close();
    await refreshConversations();
    navigate(`/app/dm/${conversation.id}`);
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

async function toggleBlock(user, dialog) {
  try {
    if (user.blockedByMe) {
      await api.del(`/api/users/${user.id}/block`);
      toast(`${user.displayName} engeli kaldırıldı.`, 'success');
    } else {
      await api.post(`/api/users/${user.id}/block`);
      toast(`${user.displayName} engellendi. Artık size özel mesaj gönderemez.`, 'success');
    }
    dialog?.close();
    await refreshConversations().catch(() => {});
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

/** Üye kartını açar: profil bilgisi, özel mesaj, engelleme ve şikayet. */
export async function openUserCard(userId) {
  let user;
  try {
    ({ user } = await api.get(`/api/users/${userId}`));
  } catch (err) {
    toast(errorText(err), 'error');
    return;
  }
  const me = store.state.user;
  let dialog;
  const actions = [];
  if (user.isSelf) {
    actions.push(h('a', { class: 'btn btn-primary', href: '/profile', onclick: () => dialog?.close() }, 'Profilimi düzenle'));
  } else {
    actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startDirectMessage(user.id, dialog) }, '💬 Özel mesaj'));
    actions.push(
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => toggleBlock(user, dialog) }, user.blockedByMe ? 'Engeli kaldır' : 'Engelle'),
    );
    actions.push(
      h('button', { class: 'btn btn-danger', type: 'button', onclick: () => openReportModal({ userId: user.id, label: user.displayName }) }, 'Şikayet et'),
    );
    if (isStaff(me)) {
      actions.push(
        h('a', { class: 'btn btn-ghost', href: `/admin/users?q=${encodeURIComponent(user.username)}`, onclick: () => dialog?.close() }, 'Yönetim kaydı'),
      );
    }
  }
  const body = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'profile-head' },
      avatar(user, 72),
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'profile-name' }, user.displayName, ' ', roleBadge(user.role)),
        h('div', { class: 'muted small' }, `@${user.username}`),
        h(
          'div',
          { class: 'row small muted' },
          h('span', { class: `dot ${user.online ? 'dot-online' : ''}` }),
          user.online ? 'Çevrimiçi' : 'Çevrimdışı',
        ),
      ),
    ),
    user.bio ? h('p', { class: 'bio' }, user.bio) : h('p', { class: 'faint small' }, 'Henüz bir biyografi eklenmemiş.'),
    h('p', { class: 'faint small' }, `Katılım: ${formatShortDate(user.createdAt)}`),
  );
  dialog = openDialog({ title: 'Üye profili', body, footer: actions });
  return dialog;
}

/** Sayfa dışında da kullanılabilmesi için küçük yardımcılar. */
export { withQuery, HELP_AREA_LABELS, field };
