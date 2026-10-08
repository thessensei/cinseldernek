/**
 * Güvenli DOM yardımcıları. Kullanıcı verisi asla innerHTML ile eklenmez:
 * metinler her zaman text node olarak oluşturulur.
 */

/** h('a', { href, class: 'x' }, 'Metin', childNode) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'for') el.htmlFor = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') el[key] = value;
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)"'\]])/gi;

/** Düz metindeki bağlantıları (yalnızca http/https) tıklanabilir bağlantıya çevirir. */
export function linkify(text) {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of String(text).matchAll(URL_PATTERN)) {
    const raw = match[0];
    const index = match.index;
    if (index > last) fragment.append(text.slice(last, index));
    const href = raw.toLowerCase().startsWith('www.') ? `https://${raw}` : raw;
    fragment.append(h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, raw));
    last = index + raw.length;
  }
  if (last < text.length) fragment.append(text.slice(last));
  return fragment;
}

/** Düğmeyi bekleme durumuna alır; işlem bitince eski haline döndürür. */
export async function withPending(button, task, pendingText) {
  const original = button.textContent;
  button.disabled = true;
  if (pendingText) button.textContent = pendingText;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
