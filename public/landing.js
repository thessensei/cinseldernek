(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const message = $('#form-message');
  const loginForm = $('#login-form');
  const registerForm = $('#register-form');
  let activeTab = 'login';

  function setMessage(text, type = 'error') {
    message.textContent = text;
    message.className = `form-message ${type === 'success' ? 'is-success' : 'is-error'}`;
    message.hidden = !text;
  }

  function clearMessage() {
    message.textContent = '';
    message.className = 'form-message';
    message.hidden = true;
  }

  function switchTab(tab, shouldScroll = false) {
    activeTab = tab === 'register' ? 'register' : 'login';
    const isRegister = activeTab === 'register';
    $('#tab-login').classList.toggle('is-active', !isRegister);
    $('#tab-register').classList.toggle('is-active', isRegister);
    $('#tab-login').setAttribute('aria-selected', String(!isRegister));
    $('#tab-register').setAttribute('aria-selected', String(isRegister));
    $('#login-panel').hidden = isRegister;
    $('#register-panel').hidden = !isRegister;
    clearMessage();
    if (shouldScroll) $('#auth-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({ ok: false, error: 'Sunucudan geçerli bir yanıt alınamadı.' }));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'İşlem tamamlanamadı. Lütfen tekrar dene.');
    return data;
  }

  function setBusy(form, busy, submitText) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent.trim();
      button.disabled = true;
      button.textContent = submitText;
    } else {
      button.disabled = false;
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    }
  }

  async function submitAuth(form, path, payload, successText) {
    clearMessage();
    setBusy(form, true, 'Biraz bekle…');
    try {
      await request(path, { method: 'POST', body: JSON.stringify(payload) });
      setMessage(successText, 'success');
      window.location.replace('/app.html');
    } catch (error) {
      setMessage(error.message || 'Bağlantı kurulamadı. Biraz sonra tekrar dene.');
      setBusy(form, false);
    }
  }

  document.querySelectorAll('[data-auth-tab]').forEach((control) => {
    control.addEventListener('click', (event) => {
      const tab = control.dataset.authTab;
      if (control.tagName === 'A') event.preventDefault();
      switchTab(tab, control.tagName === 'A');
    });
  });

  document.querySelectorAll('[data-action="quick-exit"]').forEach((button) => {
    button.addEventListener('click', () => window.location.replace('https://www.google.com/search?q=hava+durumu'));
  });

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(loginForm);
    submitAuth(loginForm, '/api/auth/login', {
      email: String(form.get('email') || '').trim(),
      password: String(form.get('password') || ''),
    }, 'Giriş başarılı. Güvenli alanın açılıyor…');
  });

  registerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(registerForm);
    submitAuth(registerForm, '/api/auth/register', {
      name: String(form.get('name') || '').trim(),
      email: String(form.get('email') || '').trim(),
      password: String(form.get('password') || ''),
      supportArea: String(form.get('supportArea') || ''),
    }, 'Aramıza hoş geldin. Güvenli alanın açılıyor…');
  });

  $('#google-button').addEventListener('click', () => { window.location.assign('/auth/google'); });
  $('#google-register-button').addEventListener('click', () => { window.location.assign('/auth/google'); });
  $('#demo-button').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    clearMessage();
    try {
      await request('/api/auth/demo', { method: 'POST', body: '{}' });
      window.location.replace('/app.html');
    } catch (error) {
      setMessage(error.message || 'Demo hesabı şu anda açılamıyor.');
      button.disabled = false;
    }
  });

  const params = new URLSearchParams(window.location.search);
  const authErrors = {
    cancelled: 'Google girişi iptal edildi.',
    state: 'Güvenlik doğrulaması tamamlanamadı. Lütfen yeniden dene.',
    failed: 'Google girişi tamamlanamadı. E-posta ve parola ile giriş yapabilirsin.',
    unavailable: 'Google girişi henüz yapılandırılmadı. E-posta ve parola ile devam edebilirsin.',
  };
  if (params.get('gerror')) setMessage(authErrors[params.get('gerror')] || 'Google girişi tamamlanamadı.');
  if (params.get('reason') === 'session') setMessage('Oturumun sona ermiş. Lütfen yeniden giriş yap.');

  Promise.allSettled([
    request('/api/public-config'),
    request('/api/me'),
  ]).then(([configResult, meResult]) => {
    if (configResult.status === 'fulfilled') {
      const config = configResult.value;
      $('#google-button').hidden = !config.googleEnabled;
      $('#google-register-button').hidden = !config.googleEnabled;
      $('#demo-button').hidden = !config.demoEnabled;
      const divider = $('.form-divider');
      if (!config.googleEnabled && !config.demoEnabled) divider.hidden = true;
    }
    if (meResult.status === 'fulfilled' && meResult.value.user) {
      window.location.replace('/app.html');
    }
  });

  switchTab('login');
})();
