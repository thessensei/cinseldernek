import { h, clear } from '../core/dom.js';
import { initials, ROLE_LABELS } from '../core/format.js';

export function avatar(user, size = 36) {
  const color = user?.avatarColor || '#c962ff';
  return h(
    'span',
    {
      class: 'avatar',
      'aria-hidden': 'true',
      style: { background: `linear-gradient(135deg, ${color}, #c962ff)`, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` },
    },
    initials(user?.displayName || user?.username || '?'),
  );
}

export function roleBadge(role) {
  if (role === 'admin') return h('span', { class: 'badge badge-admin' }, ROLE_LABELS.admin);
  if (role === 'moderator') return h('span', { class: 'badge badge-mod' }, ROLE_LABELS.moderator);
  return null;
}

export function statusBadge(status) {
  const map = { active: ['badge-ok', 'Aktif'], banned: ['badge-danger', 'Yasaklı'], deleted: ['badge-muted', 'Silinmiş'] };
  const [cls, label] = map[status] ?? ['badge-muted', status];
  return h('span', { class: `badge ${cls}` }, label);
}

export function errorText(error) {
  return error?.message || 'Beklenmeyen bir hata oluştu.';
}

export function formError() {
  return h('div', { class: 'form-error', role: 'alert' });
}

export function setFormError(node, message) {
  node.textContent = message || '';
}

/** Etiketli alan. Döner: { wrap, input } */
export function field({ label, name, type = 'text', value = '', placeholder = '', required = false, hint, autocomplete, maxlength, minlength, id }) {
  const fieldId = id || `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const input = h('input', {
    id: fieldId,
    class: 'input',
    name,
    type,
    value,
    placeholder,
    required,
    autocomplete,
    maxlength,
    minlength,
  });
  const wrap = h('div', { class: 'field' }, h('label', { for: fieldId }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  return { wrap, input };
}

export function textareaField({ label, name, value = '', placeholder = '', rows = 4, maxlength, hint, id }) {
  const fieldId = id || `t-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const input = h('textarea', { id: fieldId, class: 'textarea', name, rows, placeholder, maxlength }, value);
  const wrap = h('div', { class: 'field' }, h('label', { for: fieldId }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  return { wrap, input };
}

export function selectField({ label, name, options, value = '', required = false, id, placeholder }) {
  const fieldId = id || `s-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const select = h(
    'select',
    { id: fieldId, class: 'select', name, required },
    placeholder ? h('option', { value: '', disabled: true, selected: !value }, placeholder) : null,
    options.map(([optionValue, text]) => h('option', { value: optionValue, selected: optionValue === value }, text)),
  );
  const wrap = h('div', { class: 'field' }, h('label', { for: fieldId }, label), select);
  return { wrap, input: select };
}

export function emptyState(text) {
  return h('div', { class: 'empty' }, text);
}

export function loading(text = 'Yükleniyor…') {
  return h('div', { class: 'empty', role: 'status' }, text);
}

export function pageHeader({ title, subtitle, actions }) {
  return h(
    'div',
    { class: 'page-head' },
    h('div', null, h('h1', null, title), subtitle ? h('p', null, subtitle) : null),
    actions ? h('div', { class: 'toolbar' }, actions) : null,
  );
}

/** Basit veri tablosu. columns: [{ label, render(row) => Node|string, className }] */
export function table({ columns, rows, empty = 'Kayıt bulunamadı.', onRowClick }) {
  const head = h('tr', null, columns.map((column) => h('th', { scope: 'col', class: column.className }, column.label)));
  const body = rows.length
    ? rows.map((row) =>
        h(
          'tr',
          { class: onRowClick ? 'clickable-row' : undefined, onclick: onRowClick ? () => onRowClick(row) : undefined },
          columns.map((column) => h('td', { class: column.className }, column.render(row))),
        ),
      )
    : h('tr', null, h('td', { colspan: columns.length, class: 'faint', style: { textAlign: 'center', padding: '1.6rem' } }, empty));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, head), h('tbody', null, body)));
}

export function pager({ page, limit, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return h(
    'nav',
    { class: 'pager', 'aria-label': 'Sayfalar' },
    h('button', { class: 'btn btn-sm', type: 'button', disabled: page <= 1, onclick: () => onChange(page - 1) }, '← Önceki'),
    h('span', null, `Sayfa ${page} / ${pages} · ${total} kayıt`),
    h('button', { class: 'btn btn-sm', type: 'button', disabled: page >= pages, onclick: () => onChange(page + 1) }, 'Sonraki →'),
  );
}

export function replaceContent(node, ...children) {
  clear(node);
  node.append(...children.flat().filter(Boolean));
  return node;
}

export function pendingButton(label, onClick, className = 'btn btn-primary') {
  return h('button', { class: className, type: 'button', onclick: onClick }, label);
}

export function formatCount(value) {
  return new Intl.NumberFormat('tr-TR').format(value ?? 0);
}
