import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { isCurrent } from '../../core/router.js';
import { store } from '../../core/store.js';
import { adminFrame } from './frame.js';
import { toast } from '../../components/feedback.js';
import { errorText, formError, loading, setFormError, textareaField } from '../../components/ui.js';

export async function renderSettings({ id }) {
  const content = adminFrame('settings', 'Site ayarları');
  content.replaceChildren(h('h1', null, 'Site ayarları'), loading());
  let settings;
  try {
    ({ settings } = await api.get('/api/admin/settings'));
  } catch (err) {
    if (isCurrent(id)) content.replaceChildren(h('h1', null, 'Site ayarları'), h('p', { class: 'form-error' }, errorText(err)));
    return;
  }
  if (!isCurrent(id)) return;

  const announcement = textareaField({
    label: 'Site duyurusu',
    name: 'announcement',
    value: settings.announcement,
    rows: 3,
    maxlength: 500,
    hint: 'Boş bırakırsanız duyuru gösterilmez. Tüm sayfaların üstünde görünür.',
  });
  const registration = h('input', { type: 'checkbox', checked: settings.registrationOpen });
  const error = formError();
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Ayarları kaydet');
  save.addEventListener('click', async () => {
    setFormError(error, '');
    save.disabled = true;
    try {
      const { settings: next } = await api.put('/api/admin/settings', {
        announcement: announcement.input.value.trim(),
        registrationOpen: registration.checked,
      });
      store.set({ settings: next });
      toast('Ayarlar kaydedildi.', 'success');
    } catch (err) {
      setFormError(error, errorText(err));
    } finally {
      save.disabled = false;
    }
  });

  content.replaceChildren(
    h('h1', null, 'Site ayarları'),
    h('p', { class: 'lead' }, 'Duyuru ve kayıt davranışını buradan yönetin. Değişiklikler açık sekmelere anında yansır.'),
    h(
      'div',
      { class: 'settings-block' },
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Duyuru bandı'),
        announcement.wrap,
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Kayıtlar'),
        h('label', { class: 'check' }, registration, 'Yeni üye kayıtlarına açık'),
        h('p', { class: 'faint small', style: { marginTop: '0.5rem' } }, 'Kapalıyken kayıt formu devre dışı kalır; mevcut üyeler giriş yapmaya devam eder.'),
      ),
      error,
      h('div', { class: 'form-actions' }, save),
    ),
  );
}
