import { h } from '../core/dom.js';

/* ---------------- Bildirimler ---------------- */

export function toast(message, kind = 'info') {
  const container = document.getElementById('toasts');
  if (!container) return;
  const item = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  container.append(item);
  setTimeout(() => item.remove(), kind === 'error' ? 6000 : 3800);
}

/* ---------------- Diyaloglar ---------------- */

/** Erişilebilir <dialog> tabanlı pencere. Kapanınca onClose çağrılır. */
export function openDialog({ title, body, footer, onClose, wide = false }) {
  const dialog = h(
    'dialog',
    { class: 'modal' },
    h(
      'div',
      { class: 'modal-box', style: wide ? { width: 'min(820px, 94vw)' } : undefined },
      h(
        'div',
        { class: 'modal-head' },
        h('h2', null, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Kapat', onclick: () => dialog.close() }, '✕'),
      ),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-foot' }, footer) : null,
    ),
  );
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.(dialog.returnValue);
  });
  document.body.append(dialog);
  dialog.showModal();
  const firstField = dialog.querySelector('input, textarea, select');
  if (firstField) firstField.focus();
  return dialog;
}

/** Onay penceresi. Kullanıcı onaylarsa true, vazgeçerse false döner. */
export function confirmDialog({ title, message, confirmLabel = 'Onayla', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = openDialog({
      title,
      body: h('p', { class: 'muted' }, message),
      footer: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dialog.close() }, 'Vazgeç'),
        h(
          'button',
          {
            class: danger ? 'btn btn-danger' : 'btn btn-primary',
            type: 'button',
            onclick: () => {
              finish(true);
              dialog.close();
            },
          },
          confirmLabel,
        ),
      ],
      onClose: () => finish(false),
    });
    return dialog;
  });
}
