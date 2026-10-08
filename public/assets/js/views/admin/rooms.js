import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { isCurrent } from '../../core/router.js';
import { adminFrame } from './frame.js';
import { confirmDialog, openDialog, toast } from '../../components/feedback.js';
import { errorText, field, formError, loading, setFormError, table, textareaField } from '../../components/ui.js';

function roomDialog(room, onDone) {
  const name = field({ label: 'Oda adı', name: 'name', value: room?.name ?? '', required: true, maxlength: 60 });
  const slug = field({ label: 'Bağlantı adı (slug)', name: 'slug', value: room?.slug ?? '', maxlength: 60, hint: 'Boş bırakılırsa addan üretilir.' });
  const description = textareaField({ label: 'Açıklama', name: 'description', value: room?.description ?? '', rows: 2, maxlength: 300 });
  const readonly = h('input', { type: 'checkbox', checked: Boolean(room?.isReadonly) });
  const archived = h('input', { type: 'checkbox', checked: Boolean(room?.isArchived) });
  const order = field({ label: 'Sıra', name: 'sortOrder', type: 'number', value: String(room?.sortOrder ?? 0), hint: 'Küçük değerler önce gelir.' });
  const error = formError();
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, room ? 'Kaydet' : 'Oda oluştur');
  let dialog;
  save.addEventListener('click', async () => {
    setFormError(error, '');
    save.disabled = true;
    const payload = {
      name: name.input.value.trim(),
      slug: slug.input.value.trim(),
      description: description.input.value.trim(),
      isReadonly: readonly.checked,
      isArchived: archived.checked,
      sortOrder: Number(order.input.value) || 0,
    };
    try {
      if (room) await api.patch(`/api/admin/rooms/${room.id}`, payload);
      else await api.post('/api/admin/rooms', payload);
      toast(room ? 'Oda güncellendi.' : 'Oda oluşturuldu.', 'success');
      dialog.close();
      onDone();
    } catch (err) {
      setFormError(error, errorText(err));
      save.disabled = false;
    }
  });
  dialog = openDialog({
    title: room ? 'Odayı düzenle' : 'Yeni oda',
    body: h(
      'div',
      { class: 'stack' },
      h('div', { class: 'form-row' }, name.wrap, slug.wrap),
      description.wrap,
      h('label', { class: 'check' }, readonly, 'Salt okunur (yalnızca yöneticiler yazabilir)'),
      h('label', { class: 'check' }, archived, 'Arşivli (üyeler göremez, yeni mesaj gönderilemez)'),
      order.wrap,
      error,
    ),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dialog.close() }, 'Vazgeç'), save],
  });
}

export async function renderRooms({ id }) {
  const content = adminFrame('rooms', 'Sohbet odaları');
  const tableHost = h('div', null, loading());

  async function remove(room) {
    const ok = await confirmDialog({
      title: 'Odayı sil',
      message: `"${room.name}" odası ve içindeki tüm mesajlar kalıcı olarak silinecek. Bunun yerine arşivlemeyi düşünün.`,
      confirmLabel: 'Odayı sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/rooms/${room.id}`);
      toast('Oda silindi.', 'success');
      load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function load() {
    try {
      const { rooms } = await api.get('/api/admin/rooms');
      if (!isCurrent(id)) return;
      tableHost.replaceChildren(
        table({
          columns: [
            { label: 'Oda', render: (room) => h('div', null, h('div', null, room.name), h('div', { class: 'faint small' }, `#${room.slug}`)) },
            { label: 'Açıklama', className: 'wrap', render: (room) => room.description || '—' },
            {
              label: 'Durum',
              render: (room) =>
                h(
                  'span',
                  { class: 'row' },
                  room.isReadonly ? h('span', { class: 'badge badge-warn' }, 'Salt okunur') : null,
                  room.isArchived ? h('span', { class: 'badge badge-muted' }, 'Arşivli') : null,
                  !room.isReadonly && !room.isArchived ? h('span', { class: 'badge badge-ok' }, 'Açık') : null,
                ),
            },
            { label: 'Mesaj', render: (room) => String(room.messageCount) },
            { label: 'Sıra', render: (room) => String(room.sortOrder) },
            {
              label: '',
              className: 'actions',
              render: (room) =>
                h(
                  'span',
                  { class: 'row', style: { justifyContent: 'flex-end' } },
                  h('button', { class: 'btn btn-sm', type: 'button', onclick: () => roomDialog(room, load) }, 'Düzenle'),
                  h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => remove(room) }, 'Sil'),
                ),
            },
          ],
          rows: rooms,
          empty: 'Henüz oda yok.',
        }),
      );
    } catch (err) {
      tableHost.replaceChildren(h('p', { class: 'form-error' }, errorText(err)));
    }
  }

  content.replaceChildren(
    h('div', { class: 'row-between', style: { marginBottom: '0.4rem' } }, h('h1', null, 'Sohbet odaları'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => roomDialog(null, load) }, '+ Yeni oda')),
    h('p', { class: 'lead' }, 'Odalar yönetici tarafından oluşturulur. Salt okunur odalarda yalnızca yöneticiler ve moderatörler yazabilir; arşivli odalar üyelere gizlenir.'),
    tableHost,
  );
  await load();
}
