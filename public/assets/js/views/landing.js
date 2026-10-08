import { api } from '../core/api.js';
import { h, withPending } from '../core/dom.js';
import { HELP_AREA_LABELS } from '../core/format.js';
import { store } from '../core/store.js';
import { startRealtime } from '../core/realtime.js';
import { refreshAll } from '../core/sync.js';
import { mountShell, setTitle } from '../components/layout.js';
import { toast } from '../components/feedback.js';
import { errorText, field, formError, selectField, setFormError } from '../components/ui.js';
import { navigate } from '../core/router.js';

const FEATURES = [
  ['🧠', 'Psikolojik Destek', 'Uzman danışmanlarla güvenli sohbet'],
  ['⚖️', 'Hukuki Yardım', 'Hakların için yanında olan avukatlar'],
  ['🤝', 'Topluluk Ağı', 'Seni anlayan insanlarla bağlan'],
  ['🏠', 'Güvenli Sığınak', 'Acil barınma ve yönlendirme'],
];

/** Yalnızca site içi göreli yollara izin verir (açık yönlendirmeyi önler). */
export function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/app';
}

function afterLogin(user, next) {
  store.set({ user });
  startRealtime();
  refreshAll().catch(() => {});
  navigate(safeNext(next), { replace: true });
}

function loginForm(next) {
  const identifier = field({
    label: 'E-posta veya rumuz',
    name: 'identifier',
    placeholder: '✉️  E-posta veya rumuz',
    required: true,
    autocomplete: 'username',
  });
  const password = field({
    label: 'Parola',
    name: 'password',
    type: 'password',
    placeholder: '🔒  Parola',
    required: true,
    autocomplete: 'current-password',
  });
  const error = formError();
  const submit = h('button', { class: 'btn btn-primary btn-block btn-lg submit-wide', type: 'submit' }, 'GİRİŞ YAP');
  const form = h(
    'form',
    { class: 'form', 'aria-label': 'Giriş formu' },
    identifier.wrap,
    password.wrap,
    error,
    submit,
    h('p', { class: 'form-note' }, 'Verilerini asla paylaşmıyoruz. Gizlilik önce gelir.'),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(error, '');
    await withPending(
      submit,
      async () => {
        try {
          const { user } = await api.post('/api/auth/login', {
            identifier: identifier.input.value.trim(),
            password: password.input.value,
          });
          afterLogin(user, next);
        } catch (err) {
          setFormError(error, errorText(err));
          password.input.value = '';
        }
      },
      'Giriş yapılıyor…',
    );
  });
  return form;
}

function registerForm(next) {
  const username = field({
    label: 'Rumuz',
    name: 'username',
    placeholder: '✨  Rumuz (3-24 karakter)',
    required: true,
    autocomplete: 'username',
    maxlength: 24,
    hint: 'Harf, rakam, _ . - kullanabilirsin. Gerçek adını paylaşmak zorunda değilsin.',
  });
  const email = field({
    label: 'E-posta',
    name: 'email',
    type: 'email',
    placeholder: '✉️  E-posta',
    required: true,
    autocomplete: 'email',
  });
  const password = field({
    label: 'Parola',
    name: 'password',
    type: 'password',
    placeholder: '🔒  Parola oluştur (en az 8 karakter)',
    required: true,
    autocomplete: 'new-password',
    minlength: 8,
  });
  const helpOptions = Object.entries(HELP_AREA_LABELS);
  const helpArea = selectField({
    label: 'Destek alanı',
    name: 'helpArea',
    options: helpOptions,
    required: true,
    placeholder: '💜  Hangi Alanda Destek İstiyorsun?',
  });
  const error = formError();
  const submit = h('button', { class: 'btn btn-primary btn-block btn-lg submit-wide', type: 'submit' }, 'ARAMIZA KATIL 🏳️‍🌈');
  const form = h(
    'form',
    { class: 'form', 'aria-label': 'Kayıt formu' },
    username.wrap,
    email.wrap,
    password.wrap,
    helpArea.wrap,
    error,
    submit,
    h('p', { class: 'form-note' }, 'Rumuzunla katılabilirsin; gerçek adını paylaşmak zorunda değilsin. Gizlilik garantisi.'),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(error, '');
    await withPending(
      submit,
      async () => {
        try {
          const { user } = await api.post('/api/auth/register', {
            username: username.input.value.trim(),
            email: email.input.value.trim(),
            password: password.input.value,
            helpArea: helpArea.input.value,
          });
          toast(`Hoş geldin, ${user.username}! 🏳️‍🌈`, 'success');
          afterLogin(user, next);
        } catch (err) {
          setFormError(error, errorText(err));
        }
      },
      'Hesap oluşturuluyor…',
    );
  });
  return form;
}

function authCard(tab, next) {
  const settings = store.state.settings;
  const card = h('div', { class: 'auth-card' });
  const panel = (() => {
    if (tab === 'register') {
      if (!settings.registrationOpen) {
        return h('div', { class: 'alert alert-warn' }, 'Yeni kayıtlar şu anda kapalı. Lütfen daha sonra tekrar deneyin.');
      }
      return registerForm(next);
    }
    return loginForm(next);
  })();

  const switchTo = (target) => {
    const path = target === 'register' ? '/register' : '/login';
    history.replaceState({}, '', path + (next && next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''));
    card.replaceWith(authCard(target, next));
  };

  const tabs = h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': 'Giriş veya kayıt' },
    h('button', { class: 'tab-btn', type: 'button', role: 'tab', 'aria-selected': String(tab === 'login'), onclick: () => switchTo('login') }, 'Giriş Yap'),
    h('button', { class: 'tab-btn', type: 'button', role: 'tab', 'aria-selected': String(tab === 'register'), onclick: () => switchTo('register') }, 'Kayıt Ol'),
  );
  card.append(tabs, panel);
  return card;
}

export function renderLanding({ tab = 'login', next = '' } = {}) {
  setTitle(null);
  const main = mountShell('public', 'home');
  main.replaceChildren(
    h(
      'section',
      { class: 'hero' },
      h('div', { class: 'hero-badge' }, '🏳️‍🌈 Güvenli Alan · Dayanışma · Özgürlük'),
      h('h1', null, 'Sen olduğun gibi', h('br'), h('em', null, 'mükemmelsin.')),
      h(
        'p',
        null,
        'LGBTİ+, queer, interseks, aseksüel ya da kim olursan ol — bu platform sana ait. Destek, hukuk, psikoloji, topluluk.',
      ),
      h(
        'div',
        { class: 'hero-actions' },
        h('a', { class: 'btn btn-lg btn-primary', href: '/register' }, 'Aramıza katıl'),
        h('a', { class: 'btn btn-lg', href: '/blog' }, 'Blogu oku'),
      ),
    ),
    h(
      'div',
      { class: 'feature-grid' },
      FEATURES.map(([icon, title, text]) =>
        h('div', { class: 'feature-card' }, h('span', { class: 'card-icon', 'aria-hidden': 'true' }, icon), h('h3', null, title), h('p', null, text)),
      ),
    ),
    h('section', { class: 'auth-wrap', id: 'auth' }, authCard(tab, next)),
  );
}
