import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { mountShell, setTitle } from '../components/layout.js';

export function renderNotFound() {
  const user = store.state.user;
  const main = mountShell(user ? 'app' : 'public', 'none');
  setTitle('Sayfa bulunamadı');
  main.replaceChildren(
    h(
      'div',
      { class: 'page-narrow', style: { textAlign: 'center', paddingTop: '4rem' } },
      h('div', { style: { fontSize: '4rem', fontWeight: 900 } }, '404'),
      h('p', { class: 'muted', style: { margin: '0.6rem 0 1.6rem' } }, 'Aradığın sayfa bulunamadı. Yolun açık olsun 🌈'),
      h('a', { class: 'btn btn-primary', href: user ? '/app' : '/' }, 'Ana sayfaya dön'),
    ),
  );
}
