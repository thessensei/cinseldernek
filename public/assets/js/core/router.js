import { store, isAdmin, isStaff } from './store.js';

/**
 * Küçük History API yönlendiricisi.
 * auth: 'user' (giriş gerekir) | 'guest' (yalnızca çıkış yapmış) | 'staff' | 'admin' | undefined
 */
const routes = [];
let notFound = () => {};
let renderSeq = 0;

function compile(pattern) {
  const names = [];
  const source = pattern.replace(/:([a-zA-Z_]+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  const regex = new RegExp(`^${source === '/' ? '' : source}/?$`);
  return { regex, names };
}

export function route(pattern, options, handler) {
  routes.push({ pattern, ...compile(pattern), options: options ?? {}, handler });
}

export function setNotFound(handler) {
  notFound = handler;
}

/** Bu render çağrısı hâlâ güncel mi? (Eşzamansız veri yüklemesinden sonra kontrol edin.) */
export function isCurrent(id) {
  return id === renderSeq;
}

/** Geçerli render kimliği (aynı sayfayı yeniden çizmek için). */
export function currentRenderId() {
  return renderSeq;
}

export function navigate(url, { replace = false } = {}) {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) {
    location.href = target.href;
    return;
  }
  const next = target.pathname + target.search + target.hash;
  const current = location.pathname + location.search + location.hash;
  if (next !== current || replace) {
    if (replace) history.replaceState({}, '', next);
    else history.pushState({}, '', next);
  }
  resolve();
}

function loginRedirect() {
  const next = location.pathname + location.search;
  return `/login?next=${encodeURIComponent(next)}`;
}

export function resolve() {
  const id = ++renderSeq;
  const path = location.pathname;
  const query = new URLSearchParams(location.search);
  const user = store.state.user;

  for (const entry of routes) {
    const match = entry.regex.exec(path);
    if (!match) continue;
    const params = {};
    entry.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });

    const guard = entry.options.auth;
    if (guard === 'user' && !user) return navigate(loginRedirect(), { replace: true });
    if (guard === 'guest' && user) return navigate(query.get('next') || '/app', { replace: true });
    if (guard === 'staff' && !isStaff(user)) return navigate(user ? '/app' : loginRedirect(), { replace: true });
    if (guard === 'admin' && !isAdmin(user)) return navigate(user ? '/admin' : loginRedirect(), { replace: true });

    Promise.resolve()
      .then(() => entry.handler({ path, params, query, id }))
      .catch((error) => {
        console.error(error);
        window.dispatchEvent(new CustomEvent('spektrum:error', { detail: error }));
      });
    return undefined;
  }
  notFound({ path, id });
  return undefined;
}

/** Sayfa içi bağlantıları yakalar; tam sayfa yenilemesi yerine yönlendirme yapar. */
export function installLinkInterceptor() {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener('popstate', () => resolve());
}
