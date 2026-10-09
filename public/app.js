(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = {
    user: null,
    page: 'home',
    category: 'tumu',
    openComments: new Set(),
    chat: {
      root: null, activeId: null, activeType: null, activeTitle: '', activeSubtitle: '',
      supportId: null, conversations: [], inbox: [], directoryBusy: false,
    },
    notificationOpen: false,
    redirecting: false,
    focusPostId: null,
    pollBusy: false,
    toastTimer: null,
  };

  const PAGE_META = {
    home: { title: 'Genel bakış', eyebrow: 'SANA ÖZEL ALAN' },
    wall: { title: 'Topluluk duvarı', eyebrow: 'BİRLİKTE DAHA GÜÇLÜYÜZ' },
    chat: { title: 'Sohbet', eyebrow: 'GÜVENLİ İLETİŞİM' },
    support: { title: 'Destek iste', eyebrow: 'DESTEK VE YÖNLENDİRME' },
    pack: { title: 'Destek çantam', eyebrow: 'KENDİ SÜRECİN' },
    resources: { title: 'Kaynaklar', eyebrow: 'GÜVENİLİR BİLGİ' },
    profile: { title: 'Profil ayarları', eyebrow: 'HESABIN' },
  };
  const CATEGORY_LABELS = {
    genel: 'Genel', psikolojik: 'Psikolojik destek', hukuk: 'Hukuk', topluluk: 'Topluluk', barinma: 'Barınma',
    diger: 'Diğer', gonullu: 'Gönüllülük', acil: 'Acil destek', aile: 'Aile desteği', destek: 'Destek',
  };
  const REQUEST_STATUS = { beklemede: 'Beklemede', inceleniyor: 'İnceleniyor', tamamlandi: 'Tamamlandı', kapatildi: 'Kapatıldı' };

  function el(tag, className = '', text = '') {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined && text !== null) item.textContent = String(text);
    return item;
  }

  function button(text, className = 'button button-outline', onClick, type = 'button') {
    const item = el('button', className, text);
    item.type = type;
    if (onClick) item.addEventListener('click', onClick);
    return item;
  }

  function api(path, { method = 'GET', body, headers = {} } = {}) {
    const options = {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { ...headers },
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(path, options).then(async (response) => {
      const data = await response.json().catch(() => ({ ok: false, error: 'Sunucudan geçerli bir yanıt alınamadı.' }));
      if (response.status === 401) {
        if (!state.redirecting) {
          state.redirecting = true;
          window.location.replace('/?reason=session');
        }
        throw new Error('Oturumun sona erdi. Giriş sayfasına yönlendiriliyorsun.');
      }
      if (!response.ok || data.ok === false) throw new Error(data.error || 'İşlem tamamlanamadı.');
      return data;
    });
  }

  function showToast(text, isError = false) {
    const toast = $('#toast');
    toast.textContent = text;
    toast.classList.toggle('is-error', isError);
    toast.classList.add('is-visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  function setEmpty(container, text, isError = false) {
    container.replaceChildren(el('div', `empty-state${isError ? ' error-state' : ''}`, text));
  }

  function formatDate(value, withTime = false) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const options = withTime
      ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short' };
    return new Intl.DateTimeFormat('tr-TR', options).format(date);
  }

  function initials(value) {
    const name = String(value || 'S').trim();
    return Array.from(name)[0]?.toLocaleUpperCase('tr-TR') || 'S';
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
    } catch {
      return null;
    }
  }

  function phoneHref(value) {
    const phone = String(value || '').trim();
    const normalized = phone.replace(/[^\d+]/g, '');
    return /^\+?\d{3,15}$/.test(normalized) ? `tel:${normalized}` : null;
  }

  function pageHeading(eyebrow, title, description, action = null) {
    const heading = el('div', 'page-heading');
    const copy = el('div');
    copy.append(el('p', 'eyebrow', eyebrow), el('h1', '', title));
    if (description) copy.append(el('p', '', description));
    heading.append(copy);
    if (action) {
      const actionWrap = el('div', 'page-heading-action');
      actionWrap.append(action);
      heading.append(actionWrap);
    }
    return heading;
  }

  function surface(title, subtitle = '', className = 'surface surface-pad') {
    const section = el('section', className);
    const head = el('div', 'surface-heading');
    const copy = el('div');
    copy.append(el('h2', '', title));
    if (subtitle) copy.append(el('p', '', subtitle));
    head.append(copy);
    section.append(head);
    return { section, body: section };
  }

  function makeField(labelText, control, className = '') {
    const wrapper = el('label', `control-label${className ? ` ${className}` : ''}`);
    wrapper.append(el('span', '', labelText), control);
    return wrapper;
  }

  function makeTextInput({ name, placeholder = '', maxLength, type = 'text', value = '', required = false, className = 'control-input' } = {}) {
    const input = el('input', className);
    input.type = type;
    if (name) input.name = name;
    input.placeholder = placeholder;
    if (maxLength) input.maxLength = maxLength;
    if (value !== undefined) input.value = value;
    if (required) input.required = true;
    return input;
  }

  function makeTextarea({ name, placeholder = '', maxLength, rows = 4, value = '', required = false, className = 'control-textarea' } = {}) {
    const textarea = el('textarea', className);
    if (name) textarea.name = name;
    textarea.placeholder = placeholder;
    if (maxLength) textarea.maxLength = maxLength;
    textarea.rows = rows;
    if (value !== undefined) textarea.value = value;
    if (required) textarea.required = true;
    return textarea;
  }

  function updateSidebar() {
    if (!state.user) return;
    $('#account-rumuz').textContent = state.user.rumuz || 'Üye';
    $('#account-email').textContent = state.user.email || '';
    $('#account-avatar').textContent = initials(state.user.rumuz);
    $('#account-avatar').setAttribute('aria-label', `${state.user.rumuz} profil simgesi`);
    const supportNavLabel = $('[data-page="support"] span:nth-child(2)');
    supportNavLabel.textContent = state.user.role === 'counselor' ? 'Destek talepleri' : 'Destek iste';
  }

  function updateNav(page) {
    state.page = page;
    $$('.portal-nav-item').forEach((item) => {
      const active = item.dataset.page === page;
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    $('#page-title').textContent = PAGE_META[page]?.title || 'SPEKTRUM';
    closeSidebar();
  }

  function closeSidebar() {
    $('#portal-sidebar').classList.remove('is-open');
    $('#mobile-scrim').hidden = true;
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
  }

  async function showPage(page) {
    if (!PAGE_META[page]) page = 'home';
    updateNav(page);
    closeNotifications();
    const content = $('#page-content');
    content.replaceChildren();
    content.focus({ preventScroll: true });
    try {
      if (page === 'home') await renderHome(content);
      else if (page === 'wall') await renderWall(content);
      else if (page === 'chat') await renderChat(content);
      else if (page === 'support') await renderSupport(content);
      else if (page === 'pack') await renderPack(content);
      else if (page === 'resources') await renderResources(content);
      else if (page === 'profile') renderProfile(content);
    } catch (error) {
      if (content.isConnected) setEmpty(content, error.message || 'Bu bölüm şu anda yüklenemiyor.', true);
    }
  }

  // Home
  async function renderHome(root) {
    const page = el('div');
    const grid = el('div', 'dashboard-grid');
    const main = el('div', 'dashboard-main');
    const aside = el('aside', 'dashboard-aside');

    const welcome = el('section', 'welcome-banner');
    const welcomeCopy = el('div', 'welcome-content');
    welcomeCopy.append(
      el('p', 'eyebrow', 'GÜVENLİ ALAN · DAYANIŞMA · ÖZGÜRLÜK'),
      el('h1', '', `Merhaba, ${state.user.rumuz || 'dostum'}.`),
      el('p', '', 'Burada kendi hızındasın. İstersen topluluğa göz at, istersen bir şey paylaş ya da sana uygun desteği keşfet.'),
    );
    const actions = el('div', 'welcome-actions');
    actions.append(
      button('Topluluk duvarına git →', 'button button-primary', () => showPage('wall')),
      button('Destek seçenekleri', 'button button-outline', () => showPage('support')),
    );
    welcomeCopy.append(actions);
    welcome.append(welcomeCopy, el('div', 'welcome-seal', '✳'));
    main.append(welcome);

    const shortcuts = el('div', 'quick-grid');
    [
      ['✳', 'Paylaşım yap', 'Düşünceni paylaş', 'wall'],
      ['◌', 'Sohbete katıl', 'Toplulukla buluş', 'chat'],
      ['♡', state.user.role === 'counselor' ? 'Talepleri incele' : 'Destek iste', state.user.role === 'counselor' ? 'Üyelerin destek talepleri' : 'İhtiyacını anlat', 'support'],
    ].forEach(([icon, title, hint, target]) => {
      const card = button('', 'quick-card', () => showPage(target));
      card.append(el('span', 'quick-icon', icon), el('strong', '', title), el('small', '', hint));
      shortcuts.append(card);
    });
    main.append(shortcuts);

    const feedPanel = surface('Topluluktan son paylaşımlar', 'Rumuzlarla paylaşılan son düşünceler.');
    const feedBody = el('div', 'snapshot-list');
    setEmpty(feedBody, 'Paylaşımlar yükleniyor…');
    feedPanel.section.append(feedBody);
    const feedLink = button('Tüm paylaşımları gör →', 'text-button', () => showPage('wall'));
    feedPanel.section.querySelector('.surface-heading').append(feedLink);
    main.append(feedPanel.section);

    const noticePanel = surface('Topluluk duyuruları', 'Önemli haberler ve bilgilendirmeler.');
    const noticeBody = el('div', 'notice-list');
    setEmpty(noticeBody, 'Duyurular yükleniyor…');
    noticePanel.section.append(noticeBody);
    aside.append(noticePanel.section);

    const promo = el('section', 'resource-promo');
    promo.append(el('span', 'quick-icon', '⌕'), el('h3', '', 'Güvenilir kaynaklar'), el('p', '', 'Destek hatları ve kurum bilgileri tek yerde.'), button('Kaynakları incele →', 'text-button', () => showPage('resources')));
    aside.append(promo);

    const pack = el('section', 'support-mini');
    const packTop = el('div', 'support-mini-top');
    packTop.append(el('span', '', '▱'), el('h3', '', 'Destek çantanı düzenle'));
    const packText = el('p', '', 'İhtiyaçlarını ve istersen paylaşacağın bağlantıları kendin yönet.');
    const packButton = button('Destek çantama git →', 'button button-outline', () => showPage('pack'));
    pack.append(packTop, packText, packButton);
    aside.append(pack);

    const crisis = el('section', 'crisis-card');
    crisis.append(el('span', '', '!'), el('h3', '', 'Acil bir durum mu?'), el('p', '', 'Acil tehlikede çevrim içi yanıt bekleme. Türkiye’de acil yardım için 112’yi, sosyal destek için ALO 183’ü ara.'), button('Acil destek bilgisi', 'text-button', () => showPage('resources')));
    aside.append(crisis);

    grid.append(main, aside);
    page.append(grid);
    root.append(page);

    const [postsResult, noticesResult] = await Promise.allSettled([api('/api/posts?category=tumu'), api('/api/notices')]);
    if (!root.isConnected) return;
    if (postsResult.status === 'fulfilled') renderHomePosts(feedBody, (postsResult.value.posts || []).slice(0, 3));
    else setEmpty(feedBody, 'Paylaşımlar şu anda yüklenemiyor.', true);
    if (noticesResult.status === 'fulfilled') renderNotices(noticeBody, noticesResult.value.notices || []);
    else setEmpty(noticeBody, 'Duyurular şu anda yüklenemiyor.', true);
  }

  function renderHomePosts(container, posts) {
    container.replaceChildren();
    if (!posts.length) {
      container.append(el('p', 'snapshot-empty', 'Henüz paylaşım yok. İlk sözü sen söylemek ister misin?'));
      return;
    }
    posts.forEach((post) => {
      const row = el('article', 'snapshot-item');
      row.append(el('span', 'snapshot-avatar', initials(post.rumuz)));
      const body = el('div', 'snapshot-body');
      const meta = el('div', 'snapshot-meta');
      meta.append(el('strong', '', post.rumuz || 'Topluluk üyesi'), el('span', '', formatDate(post.created_at)));
      body.append(meta, el('p', '', post.content));
      row.append(body);
      container.append(row);
    });
  }

  function renderNotices(container, notices) {
    container.replaceChildren();
    if (!notices.length) {
      container.append(el('p', 'snapshot-empty', 'Şu an için yeni duyuru yok.'));
      return;
    }
    notices.slice(0, 5).forEach((notice) => {
      const row = el('div', 'notice-row');
      row.append(el('span', 'notice-bullet', '✦'), el('span', '', notice.text));
      container.append(row);
    });
  }

  // Community wall
  async function renderWall(root) {
    const page = el('div');
    page.append(pageHeading('TOPLULUK DUVARI', 'Birbirimize alan açalım.', 'Düşünceni rumuzunla paylaşabilir, başkalarına destek bırakabilir ya da yorumla sohbete katılabilirsin.'));
    const composer = el('section', 'surface composer-card');
    const composerTitle = el('div', 'composer-title');
    composerTitle.append(el('span', 'snapshot-avatar', initials(state.user.rumuz)));
    const composerIdentity = el('div');
    composerIdentity.append(el('strong', '', `Paylaşımın ${state.user.rumuz} adıyla görünecek`), el('small', '', 'Kişisel bilgilerini paylaşmamaya dikkat et.'));
    composerTitle.append(composerIdentity);
    const form = el('form', 'composer-form');
    const textarea = makeTextarea({ name: 'content', placeholder: 'Aklından geçenleri yaz… Buradayız, dinliyoruz.', maxLength: 500, rows: 4, required: true, className: 'control-textarea composer-textarea' });
    textarea.minLength = 2;
    const controls = el('div', 'composer-controls');
    const select = el('select', 'control-select');
    select.name = 'category';
    [
      ['genel', 'Genel paylaşım'], ['psikolojik', 'Psikolojik destek'], ['hukuk', 'Hukuk'], ['topluluk', 'Topluluk'], ['barinma', 'Barınma'],
    ].forEach(([value, label]) => { const option = el('option', '', label); option.value = value; select.append(option); });
    const rightControls = el('div', 'form-actions');
    rightControls.append(el('span', 'character-count', '0 / 500'), button('Paylaş →', 'button button-primary', null, 'submit'));
    const categoryLabel = el('label', 'control-label category-select-label');
    categoryLabel.append(el('span', 'visually-hidden', 'Paylaşım kategorisi'), select);
    controls.append(categoryLabel, rightControls);
    form.append(makeField('Yeni bir paylaşım', textarea), controls);
    composer.append(composerTitle, form);
    page.append(composer);

    const toolbar = el('div', 'feed-toolbar');
    toolbar.append(el('h2', '', 'Paylaşımlar'), el('span', 'form-hint', 'Son paylaşımlar önce gösterilir'));
    const filters = el('div', 'feed-filters');
    const posts = el('div', 'post-list');
    page.append(toolbar, filters, posts);
    root.append(page);

    const categories = [['tumu', 'Tümü'], ['genel', 'Genel'], ['psikolojik', 'Psikolojik'], ['hukuk', 'Hukuk'], ['topluluk', 'Topluluk'], ['barinma', 'Barınma']];
    function renderFilters() {
      filters.replaceChildren();
      categories.forEach(([value, label]) => {
        const chip = button(label, `filter-chip${state.category === value ? ' is-active' : ''}`, () => {
          state.category = value;
          renderFilters();
          loadPosts(posts, value);
        });
        if (state.category === value) chip.setAttribute('aria-pressed', 'true');
        else chip.setAttribute('aria-pressed', 'false');
        filters.append(chip);
      });
    }
    renderFilters();
    textarea.addEventListener('input', () => { rightControls.querySelector('.character-count').textContent = `${textarea.value.length} / 500`; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        await api('/api/posts', { method: 'POST', body: { content: textarea.value.trim(), category: select.value } });
        textarea.value = '';
        rightControls.querySelector('.character-count').textContent = '0 / 500';
        showToast('Paylaşımın duvara eklendi.');
        await loadPosts(posts, state.category);
      } catch (error) {
        showToast(error.message || 'Paylaşım eklenemedi.', true);
      } finally { submit.disabled = false; }
    });
    await loadPosts(posts, state.category);
  }

  async function loadPosts(container, category = state.category) {
    setEmpty(container, 'Paylaşımlar yükleniyor…');
    try {
      const result = await api(`/api/posts?category=${encodeURIComponent(category)}`);
      if (!container.isConnected) return;
      container.replaceChildren();
      if (!result.posts.length) {
        container.append(el('div', 'empty-state', 'Bu başlıkta henüz paylaşım yok. İlk paylaşımı sen yapabilirsin.'));
        return;
      }
      result.posts.forEach((post) => container.append(createPostCard(post)));
      if (state.focusPostId) {
        const focus = document.getElementById(`post-${state.focusPostId}`);
        if (focus) focus.scrollIntoView({ behavior: 'smooth', block: 'center' });
        state.focusPostId = null;
      }
    } catch (error) {
      if (container.isConnected) setEmpty(container, error.message || 'Paylaşımlar yüklenemedi.', true);
    }
  }

  function createPostCard(post) {
    const article = el('article', 'post-card');
    article.id = `post-${post.id}`;
    const head = el('div', 'post-header');
    const avatar = el('span', 'avatar', initials(post.rumuz));
    const tone = Math.abs(String(post.user_id || '').charCodeAt(0) || 0) % 4;
    if (tone) avatar.classList.add(`avatar-tone-${tone}`);
    const author = el('div', 'post-author');
    if (post.user_id && post.user_id !== state.user.id && post.author_role !== 'system') {
      const authorButton = button(post.rumuz || 'Topluluk üyesi', 'post-author-button', () => startDm(post.user_id));
      author.append(authorButton);
    } else {
      author.append(el('span', 'post-author-button', post.rumuz || 'Topluluk üyesi'));
    }
    const meta = el('div', 'post-meta');
    meta.append(el('span', 'post-category', CATEGORY_LABELS[post.category] || 'Genel'), el('time', '', formatDate(post.created_at, true)));
    author.append(meta);
    head.append(avatar, author);
    article.append(head, el('p', 'post-content', post.content));

    const actions = el('div', 'post-actions');
    const supports = Number(post.supports) || 0;
    const react = button(`♡ Destek · ${supports}`, `post-action${post.supported ? ' is-active' : ''}`, async () => {
      react.disabled = true;
      try {
        await api(`/api/posts/${encodeURIComponent(post.id)}/react`, { method: 'POST', body: {} });
        await loadPosts(article.parentElement, state.category);
      } catch (error) { showToast(error.message || 'Destek bırakılamadı.', true); react.disabled = false; }
    });
    react.setAttribute('aria-pressed', String(Boolean(post.supported)));
    const commentsToggle = button(`Yorumlar · ${Number(post.comment_count) || 0}`, 'post-action', () => {
      const area = article.querySelector('.comments-area');
      const opening = area.hidden;
      area.hidden = !opening;
      commentsToggle.setAttribute('aria-expanded', String(opening));
      if (opening) loadComments(post.id, area);
    });
    commentsToggle.setAttribute('aria-expanded', 'false');
    actions.append(react, commentsToggle, el('span', 'post-time', formatDate(post.created_at)));
    article.append(actions);

    const commentsArea = el('section', 'comments-area');
    commentsArea.hidden = true;
    article.append(commentsArea);
    return article;
  }

  async function loadComments(postId, area) {
    area.replaceChildren(el('div', 'empty-state', 'Yorumlar yükleniyor…'));
    try {
      const result = await api(`/api/posts/${encodeURIComponent(postId)}/comments`);
      if (!area.isConnected) return;
      area.replaceChildren();
      const list = el('div', 'comment-list');
      if (!result.comments.length) list.append(el('p', 'form-hint', 'Henüz yorum yok. Nazik bir selam bırakabilirsin.'));
      result.comments.forEach((comment) => {
        const row = el('div', 'comment-item');
        row.append(el('span', 'avatar', initials(comment.rumuz)));
        const content = el('div', 'comment-content');
        const name = el('strong');
        if (comment.user_id && comment.user_id !== state.user.id && comment.author_role !== 'system') {
          const authorButton = button(comment.rumuz || 'Topluluk üyesi', 'post-author-button', () => startDm(comment.user_id));
          name.append(authorButton);
        } else name.textContent = comment.rumuz || 'Topluluk üyesi';
        content.append(name, document.createTextNode(comment.content));
        row.append(content);
        list.append(row);
      });
      const form = el('form', 'comment-form');
      const input = makeTextarea({ name: 'comment', placeholder: 'Saygılı ve destekleyici bir yorum yaz…', maxLength: 300, rows: 2, required: true, className: 'control-textarea' });
      input.minLength = 2;
      const send = button('Gönder', 'button button-primary', null, 'submit');
      form.append(input, send);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        send.disabled = true;
        try {
          await api(`/api/posts/${encodeURIComponent(postId)}/comments`, { method: 'POST', body: { content: input.value.trim() } });
          showToast('Yorumun eklendi.');
          const card = area.closest('.post-card');
          const countButton = card?.querySelector('.post-actions .post-action:nth-child(2)');
          if (countButton) {
            const count = Number(countButton.textContent.match(/\d+/)?.[0] || 0) + 1;
            countButton.textContent = `Yorumlar · ${count}`;
          }
          await loadComments(postId, area);
        } catch (error) {
          showToast(error.message || 'Yorum eklenemedi.', true);
          send.disabled = false;
        }
      });
      area.append(list, form);
    } catch (error) { setEmpty(area, error.message || 'Yorumlar yüklenemedi.', true); }
  }

  async function startDm(userId) {
    if (!userId || userId === state.user.id) return;
    try {
      const result = await api('/api/chat/dm', { method: 'POST', body: { userId } });
      await showPage('chat');
      if (result.redirect === 'support') {
        showToast(result.info || 'Psikolojik destek kanalına yönlendirildin.');
        await openSupportChat();
      } else {
        await openChat({ id: result.conversationId, type: 'dm', peer: result.peer });
      }
    } catch (error) { showToast(error.message || 'Sohbet açılamadı.', true); }
  }

  // Chat
  async function renderChat(root) {
    const page = el('div');
    page.append(pageHeading('GÜVENLİ İLETİŞİM', 'Sohbet alanı', 'Toplulukla buluşabilir, özel mesajlarını yönetebilir veya destek kanalı üzerinden ekibe yazabilirsin.'));
    const layout = el('div', 'chat-layout');
    const directory = el('aside', 'chat-directory');
    const dirHead = el('div', 'chat-directory-head');
    const dirCopy = el('div');
    dirCopy.append(el('h2', '', 'Sohbetlerin'), el('p', '', 'Kanalları ve mesajlarını gör.'));
    dirHead.append(dirCopy, button('↻', 'text-button', () => loadChatDirectory(), 'button'));
    const dirScroll = el('div', 'chat-directory-scroll');
    directory.append(dirHead, dirScroll);

    const pane = el('section', 'chat-pane');
    const paneHead = el('div', 'chat-pane-head');
    const paneCopy = el('div', 'chat-pane-title');
    paneCopy.append(el('h2', '', 'Topluluk sohbeti'), el('p', '', 'Açık sohbet alanı'));
    paneHead.append(paneCopy, el('span', 'chat-status', 'Çevrim içi alan'));
    const messages = el('div', 'chat-messages');
    setEmpty(messages, 'Sohbet yükleniyor…');
    const form = el('form', 'chat-compose');
    const input = makeTextarea({ name: 'message', placeholder: 'Mesajını yaz…', maxLength: 1000, rows: 1, className: '' });
    input.setAttribute('aria-label', 'Sohbet mesajı');
    const send = button('Gönder →', '', null, 'submit');
    form.append(input, send);
    const crisis = el('div', 'chat-crisis-note');
    crisis.append(document.createTextNode('Acil tehlikede çevrim içi yanıt bekleme; '));
    const emergency = el('a', '', '112’yi ara'); emergency.href = 'tel:112';
    crisis.append(emergency, document.createTextNode(' veya sosyal destek için '));
    const hotline = el('a', '', 'ALO 183'); hotline.href = 'tel:183';
    crisis.append(hotline, document.createTextNode(' ile iletişime geç.'));
    pane.append(paneHead, messages, form, crisis);
    layout.append(directory, pane);
    page.append(layout);
    root.append(page);

    state.chat.root = { root, dirScroll, paneCopy, messages, form, input, send };
    form.addEventListener('submit', (event) => { event.preventDefault(); sendChat(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && window.matchMedia('(min-width: 651px)').matches) {
        event.preventDefault(); form.requestSubmit();
      }
    });
    await loadChatDirectory();
    if (state.chat.activeId) await refreshCurrentChat(true);
    else await openGlobalChat();
  }

  async function loadChatDirectory() {
    const chatRoot = state.chat.root;
    if (!chatRoot || !chatRoot.root.isConnected || state.chat.directoryBusy) return;
    state.chat.directoryBusy = true;
    try {
      const conversationsResult = await api('/api/chat/conversations');
      state.chat.conversations = conversationsResult.conversations || [];
      if (state.user.role === 'counselor') {
        const inboxResult = await api('/api/chat/support/inbox');
        state.chat.inbox = inboxResult.inbox || [];
      } else state.chat.inbox = [];
      renderChatDirectory();
    } catch (error) {
      if (chatRoot.root.isConnected) setEmpty(chatRoot.dirScroll, error.message || 'Sohbet listesi yüklenemedi.', true);
    } finally { state.chat.directoryBusy = false; }
  }

  function renderChatDirectory() {
    const chatRoot = state.chat.root;
    if (!chatRoot || !chatRoot.root.isConnected) return;
    const container = chatRoot.dirScroll;
    container.replaceChildren();

    const community = el('section', 'chat-group');
    community.append(el('span', 'chat-group-title', 'Topluluk'));
    community.append(chatListItem({ id: 'global', type: 'global', title: 'Topluluk sohbeti', subtitle: 'Herkese açık alan', icon: '◌' }));
    container.append(community);

    if (state.user.role === 'counselor') {
      const inboxGroup = el('section', 'chat-group');
      inboxGroup.append(el('span', 'chat-group-title', 'Destek gelen kutusu'));
      if (!state.chat.inbox.length) inboxGroup.append(el('p', 'form-hint', 'Henüz destek kanalı yok.'));
      state.chat.inbox.forEach((entry) => {
        inboxGroup.append(chatListItem({
          id: entry.id, type: 'support', title: entry.owner?.rumuz || 'Danışan',
          subtitle: entry.last?.content || 'İlk mesaj bekleniyor', icon: '♡', unread: entry.unread,
          owner: entry.owner,
        }));
      });
      container.append(inboxGroup);
    } else {
      const supportGroup = el('section', 'chat-group');
      supportGroup.append(el('span', 'chat-group-title', 'Destek'));
      const existingSupport = state.chat.conversations.find((item) => item.type === 'support');
      if (existingSupport) state.chat.supportId = existingSupport.id;
      supportGroup.append(chatListItem({
        id: state.chat.supportId || '__support__', type: 'support', title: 'Psikolojik destek',
        subtitle: existingSupport?.last?.content || 'Uzman destek ekibiyle özel kanal', icon: '♡', unread: existingSupport?.unread || 0,
      }));
      container.append(supportGroup);
    }

    const dms = state.chat.conversations.filter((item) => item.type === 'dm');
    const dmGroup = el('section', 'chat-group');
    dmGroup.append(el('span', 'chat-group-title', 'Özel mesajlar'));
    if (!dms.length) dmGroup.append(el('p', 'form-hint', 'Henüz özel mesajın yok. Duvar’da bir rumuza dokunarak sohbet başlatabilirsin.'));
    dms.forEach((conversation) => {
      dmGroup.append(chatListItem({
        id: conversation.id, type: 'dm', title: conversation.peer?.rumuz || 'Özel sohbet',
        subtitle: conversation.last?.content || 'Henüz mesaj yok', icon: '✉', unread: conversation.unread,
        peer: conversation.peer,
      }));
    });
    container.append(dmGroup);
  }

  function chatListItem({ id, type, title, subtitle, icon, unread = 0, peer = null, owner = null }) {
    const isActive = state.chat.activeId === id && state.chat.activeType === type;
    const item = button('', `chat-list-item${isActive ? ' is-active' : ''}`, () => {
      if (type === 'global') openGlobalChat();
      else if (type === 'support' && id === '__support__') openSupportChat();
      else openChat({ id, type, peer: peer || owner, title, subtitle: type === 'support' ? 'Özel psikolojik destek kanalı' : undefined });
    });
    item.append(el('span', 'chat-list-icon', icon));
    const copy = el('span', 'chat-list-copy');
    copy.append(el('strong', '', title), el('small', '', subtitle));
    item.append(copy);
    if (Number(unread) > 0) item.append(el('span', 'chat-unread', Number(unread) > 9 ? '9+' : unread));
    if (isActive) item.setAttribute('aria-current', 'true');
    return item;
  }

  async function openGlobalChat() {
    try {
      const result = await api('/api/chat/global');
      await openChat({ id: result.conversationId || 'global', type: 'global', title: 'Topluluk sohbeti', subtitle: 'Herkese açık sohbet alanı' });
    } catch (error) { showToast(error.message || 'Topluluk sohbeti açılamadı.', true); }
  }

  async function openSupportChat() {
    if (state.user.role === 'counselor') {
      if (state.chat.inbox.length) {
        const first = state.chat.inbox[0];
        await openChat({ id: first.id, type: 'support', peer: first.owner, title: first.owner?.rumuz || 'Danışan', subtitle: 'Özel psikolojik destek kanalı' });
      } else showToast('Henüz destek kanalı bulunmuyor.');
      return;
    }
    try {
      const result = await api('/api/chat/support');
      state.chat.supportId = result.conversationId;
      renderChatDirectory();
      await openChat({ id: result.conversationId, type: 'support', title: 'Psikolojik destek', subtitle: 'Özel kanal · Yalnızca sen ve yetkili uzman ekibi' });
    } catch (error) { showToast(error.message || 'Destek kanalı açılamadı.', true); }
  }

  async function openChat({ id, type, peer = null, title, subtitle } = {}) {
    if (!id || !state.chat.root) return;
    state.chat.activeId = id;
    state.chat.activeType = type;
    if (type === 'global') {
      state.chat.activeTitle = title || 'Topluluk sohbeti';
      state.chat.activeSubtitle = subtitle || 'Herkese açık sohbet alanı';
    } else if (type === 'dm') {
      state.chat.activeTitle = title || peer?.rumuz || 'Özel sohbet';
      state.chat.activeSubtitle = subtitle || 'Bire bir özel sohbet';
    } else {
      state.chat.activeTitle = title || peer?.rumuz || 'Psikolojik destek';
      state.chat.activeSubtitle = subtitle || (state.user.role === 'counselor' ? 'Danışanla özel destek kanalı' : 'Özel kanal · Yalnızca sen ve yetkili uzman ekibi');
    }
    const { paneCopy, input } = state.chat.root;
    paneCopy.replaceChildren(el('h2', '', state.chat.activeTitle), el('p', '', state.chat.activeSubtitle));
    input.disabled = false;
    renderChatDirectory();
    await refreshCurrentChat(true);
  }

  async function refreshCurrentChat(forceScroll = false) {
    const chatRoot = state.chat.root;
    const conversationId = state.chat.activeId;
    if (!chatRoot || !conversationId || !chatRoot.root.isConnected) return;
    try {
      const result = await api(`/api/chat/${encodeURIComponent(conversationId)}/messages`);
      if (!chatRoot.root.isConnected || state.chat.activeId !== conversationId) return;
      renderMessages(chatRoot.messages, result.messages || [], forceScroll);
    } catch (error) {
      if (chatRoot.root.isConnected) setEmpty(chatRoot.messages, error.message || 'Mesajlar yüklenemedi.', true);
    }
  }

  function renderMessages(container, messages, forceScroll = false) {
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 70;
    container.replaceChildren();
    if (!messages.length) {
      container.append(el('div', 'empty-state', 'Henüz mesaj yok. İlk selamı sen verebilirsin.'));
      return;
    }
    messages.forEach((message) => {
      const isSystem = message.author?.role === 'system';
      const row = el('article', `chat-message${message.mine ? ' is-mine' : ''}${isSystem ? ' is-system' : ''}`);
      if (!isSystem) row.append(el('span', 'chat-message-avatar', initials(message.author?.rumuz)));
      const bubbleWrap = el('div', 'chat-bubble-wrap');
      const author = message.author?.rumuz || 'SPEKTRUM Destek';
      if (message.mine || isSystem) bubbleWrap.append(el('span', 'chat-message-author', isSystem ? 'SPEKTRUM Destek' : 'Sen'));
      else if (message.author?.id) {
        bubbleWrap.append(button(author, 'chat-message-author clickable', () => startDm(message.author.id)));
      } else bubbleWrap.append(el('span', 'chat-message-author', author));
      bubbleWrap.append(el('div', 'chat-bubble', message.content), el('time', 'chat-time', formatDate(message.createdAt, true)));
      row.append(bubbleWrap);
      container.append(row);
    });
    if (forceScroll || nearBottom) container.scrollTop = container.scrollHeight;
  }

  async function sendChat() {
    const chatRoot = state.chat.root;
    if (!chatRoot || !state.chat.activeId) return;
    const content = chatRoot.input.value.trim();
    if (!content) return;
    const conversationId = state.chat.activeId;
    chatRoot.send.disabled = true;
    try {
      await api(`/api/chat/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: { content } });
      chatRoot.input.value = '';
      await refreshCurrentChat(true);
      await loadChatDirectory();
      void refreshBadges();
    } catch (error) { showToast(error.message || 'Mesaj gönderilemedi.', true); }
    finally { chatRoot.send.disabled = false; chatRoot.input.focus(); }
  }

  // Support request form
  async function renderSupport(root) {
    if (state.user.role === 'counselor') {
      await renderCounselorSupport(root);
      return;
    }
    const page = el('div');
    page.append(pageHeading('DESTEK VE YÖNLENDİRME', 'Nasıl destek olabiliriz?', 'İhtiyacını kısaca anlat. Acil bir tehlike varsa yazılı yanıtı bekleme; doğrudan acil yardım hatlarına ulaş.'));
    const grid = el('div', 'support-grid');
    const main = el('div', 'support-main');
    const aside = el('aside', 'support-aside');
    const formCard = el('section', 'surface support-form-card');
    const head = el('div', 'surface-heading');
    const headCopy = el('div');
    headCopy.append(el('h2', '', 'Destek talebi oluştur'), el('p', '', 'Talebin hesabına bağlı olarak kaydedilir. Hassas ayrıntıları paylaşmamaya dikkat et.'));
    head.append(headCopy);
    const form = el('form', 'form-grid');
    const type = el('select', 'control-select');
    type.name = 'type'; type.required = true;
    [['psikolojik', 'Psikolojik destek'], ['hukuk', 'Hukuki yönlendirme'], ['barinma', 'Güvenli barınma'], ['topluluk', 'Topluluk desteği'], ['diger', 'Diğer']].forEach(([value, label]) => {
      const option = el('option', '', label); option.value = value; type.append(option);
    });
    const subject = makeTextInput({ name: 'subject', placeholder: 'Örn. Görüşme talebi', maxLength: 100, required: true }); subject.minLength = 3;
    const message = makeTextarea({ name: 'message', placeholder: 'Neye ihtiyaç duyduğunu, rahat hissettiğin ölçüde anlat…', maxLength: 1500, rows: 5, required: true }); message.minLength = 10;
    form.append(makeField('Destek alanı', type), makeField('Konu', subject), makeField('Mesajın', message, 'span-full'));
    const formActions = el('div', 'form-actions span-full');
    formActions.append(el('p', 'form-hint', 'Talebin yalnızca kendi hesabında görüntülenir.'), button('Talebi kaydet →', 'button button-primary', null, 'submit'));
    form.append(formActions);
    formCard.append(head, form);
    main.append(formCard);

    const requestsCard = el('section', 'surface surface-pad');
    const requestsHead = el('div', 'surface-heading');
    requestsHead.append(el('div', '', ''));
    requestsHead.firstChild.append(el('h2', '', 'Taleplerim'), el('p', '', 'Daha önce oluşturduğun kayıtlar.'));
    const requestsList = el('div', 'support-list');
    setEmpty(requestsList, 'Talepler yükleniyor…');
    requestsCard.append(requestsHead, requestsList);
    main.append(requestsCard);

    const crisis = el('section', 'crisis-card');
    crisis.append(el('span', '', '!'), el('h3', '', 'Acil destek'), el('p', '', 'Kendine veya bir başkasına yönelik yakın tehlike varsa, çevrim içi yanıtı bekleme. Acil yardım için 112’yi; sosyal destek için ALO 183’ü ara.'), button('Kaynaklar sayfasına git →', 'text-button', () => showPage('resources')));
    aside.append(crisis);
    const note = el('section', 'privacy-callout');
    note.append(el('strong', '', 'Kendi sınırların önemli.'), document.createTextNode(' İhtiyacın kadarını paylaş. Parola, kimlik numarası, tam adres veya başkasına ait özel bilgileri yazma.'));
    aside.append(note);
    grid.append(main, aside);
    page.append(grid);
    root.append(page);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        await api('/api/support-requests', { method: 'POST', body: { type: type.value, subject: subject.value.trim(), message: message.value.trim() } });
        form.reset();
        showToast('Destek talebin kaydedildi.');
        await loadRequests(requestsList);
      } catch (error) { showToast(error.message || 'Talep kaydedilemedi.', true); }
      finally { submit.disabled = false; }
    });
    await loadRequests(requestsList);
  }

  async function renderCounselorSupport(root) {
    const page = el('div');
    page.append(pageHeading('UZMAN PANELİ', 'Destek talepleri', 'Üyelerden gelen talepleri incele, durumunu güncelle. Üyeye kişisel e-posta veya kimlik bilgisi gösterilmez.'));
    const panel = el('section', 'surface surface-pad');
    const head = el('div', 'surface-heading');
    const copy = el('div'); copy.append(el('h2', '', 'Gelen talepler'), el('p', '', 'Durum değişiklikleri talep sahibine bildirim olarak iletilir.'));
    head.append(copy);
    const list = el('div', 'support-list');
    setEmpty(list, 'Talepler yükleniyor…');
    panel.append(head, list);
    page.append(panel);
    root.append(page);
    await loadCounselorRequests(list);
  }

  async function loadCounselorRequests(container) {
    setEmpty(container, 'Talepler yükleniyor…');
    try {
      const result = await api('/api/counselor/support-requests');
      if (!container.isConnected) return;
      container.replaceChildren();
      if (!result.requests.length) {
        container.append(el('div', 'empty-state', 'Şu an bekleyen bir destek talebi yok.'));
        return;
      }
      result.requests.forEach((request) => {
        const card = el('article', 'request-card');
        const head = el('div', 'request-head');
        const copy = el('div');
        copy.append(el('h3', '', request.subject), el('time', 'request-date', `${request.rumuz || 'Üye'} · ${formatDate(request.created_at, true)}`));
        const statusClass = request.status === 'tamamlandi' ? 'pill pill-green' : request.status === 'beklemede' ? 'pill pill-amber' : 'pill pill-gray';
        head.append(copy, el('span', statusClass, REQUEST_STATUS[request.status] || request.status));
        const details = el('div', 'post-meta', CATEGORY_LABELS[request.type] || 'Destek');
        const message = el('p', 'request-content', request.message);
        const controls = el('div', 'request-controls');
        const status = el('select', 'control-select');
        status.setAttribute('aria-label', `${request.subject} talebinin yeni durumu`);
        Object.entries(REQUEST_STATUS).forEach(([value, label]) => {
          const option = el('option', '', label); option.value = value; status.append(option);
        });
        status.value = REQUEST_STATUS[request.status] ? request.status : 'beklemede';
        const save = button('Durumu güncelle', 'button button-primary button-small', async () => {
          save.disabled = true;
          try {
            await api(`/api/counselor/support-requests/${encodeURIComponent(request.id)}/status`, { method: 'PATCH', body: { status: status.value } });
            showToast('Talep durumu güncellendi.');
            await loadCounselorRequests(container);
          } catch (error) { showToast(error.message || 'Talep güncellenemedi.', true); save.disabled = false; }
        });
        controls.append(status, save);
        card.append(head, details, message, controls);
        container.append(card);
      });
    } catch (error) { if (container.isConnected) setEmpty(container, error.message || 'Talepler yüklenemedi.', true); }
  }

  async function loadRequests(container) {
    setEmpty(container, 'Talepler yükleniyor…');
    try {
      const result = await api('/api/support-requests');
      if (!container.isConnected) return;
      container.replaceChildren();
      if (!result.requests.length) {
        container.append(el('div', 'empty-state', 'Henüz destek talebin yok. İhtiyaç duyduğunda buradan yeni bir talep oluşturabilirsin.'));
        return;
      }
      result.requests.forEach((request) => {
        const card = el('article', 'request-card');
        const head = el('div', 'request-head');
        const copy = el('div');
        copy.append(el('h3', '', request.subject), el('time', 'request-date', formatDate(request.created_at, true)));
        const statusClass = request.status === 'tamamlandi' ? 'pill pill-green' : request.status === 'beklemede' ? 'pill pill-amber' : 'pill pill-gray';
        head.append(copy, el('span', statusClass, REQUEST_STATUS[request.status] || request.status));
        card.append(head, el('div', 'post-meta', CATEGORY_LABELS[request.type] || 'Destek'), el('p', 'request-content', request.message));
        container.append(card);
      });
    } catch (error) { if (container.isConnected) setEmpty(container, error.message || 'Talepler yüklenemedi.', true); }
  }

  // Support bag
  async function renderPack(root) {
    const page = el('div');
    page.append(pageHeading('KENDİ SÜRECİN', 'Destek çantam', 'İhtiyaçlarını not et ve paylaşmak isteyip istemediğine sen karar ver. Özel notların ve bağlantıların varsayılan olarak paylaşılmaz.'));
    const grid = el('div', 'pack-grid');
    const main = el('div', 'pack-main');
    const aside = el('aside', 'pack-aside');
    const editor = el('section', 'surface pack-card');
    const head = el('div', 'surface-heading');
    const copy = el('div'); copy.append(el('h2', '', 'Kendi notların'), el('p', '', 'Bu alan sana ait. Gerektiği kadar bilgi yaz.'));
    head.append(copy);
    const form = el('form');
    const summary = makeTextarea({ name: 'summary', placeholder: 'Örn. İhtiyacım olan destek, hedeflerim veya takip notlarım…', maxLength: 600, rows: 5 });
    const summaryField = makeField('Kişisel özet', summary);
    const linksTitle = el('div', 'surface-heading');
    const linksCopy = el('div'); linksCopy.append(el('h3', '', 'Paylaşmak istediğin bağlantılar'), el('p', '', 'En fazla 5 güvenli web bağlantısı ekleyebilirsin.'));
    linksTitle.append(linksCopy);
    const linkEditor = el('div', 'link-editor');
    const consentBox = el('div', 'consent-box');
    const consent = el('input'); consent.type = 'checkbox'; consent.name = 'approved';
    const consentLabel = el('label', 'check-row');
    consentLabel.append(consent, el('span', '', 'Bağlantılarımı, paylaşım izni açık olan diğer üyelerin görebilmesini onaylıyorum.'));
    const consentNote = el('p', 'consent-subnote', 'Bu izin yalnızca bu sayfadaki özet ve bağlantıları görünür kılar. İzni istediğin zaman geri alabilirsin. Kimlik, adres veya başka hassas bilgileri ekleme.');
    const closedWrap = el('div', 'closed-control');
    const closed = el('input'); closed.type = 'checkbox'; closed.name = 'closed';
    const closedLabel = el('label', 'check-row');
    closedLabel.append(closed, el('span', '', 'Paylaşımı geçici olarak durdur ve bağlantılarımı listeden gizle.'));
    closedWrap.append(closedLabel);
    consentBox.append(consentLabel, consentNote, closedWrap);
    const submit = button('Değişiklikleri kaydet →', 'button button-primary', null, 'submit');
    const formActions = el('div', 'form-actions');
    formActions.append(el('p', 'form-hint', 'Bağlantı paylaşımı isteğe bağlıdır.'), submit);
    form.append(summaryField, linksTitle, linkEditor, consentBox, formActions);
    editor.append(head, form);
    main.append(editor);

    const friends = el('section', 'surface surface-pad');
    const friendsHead = el('div', 'surface-heading');
    const friendCopy = el('div'); friendCopy.append(el('h2', '', 'Topluluk bağlantıları'), el('p', '', 'Yalnızca paylaşım izni veren üyelerin bilgileri.'));
    friendsHead.append(friendCopy);
    const friendList = el('div', 'friend-list');
    setEmpty(friendList, 'Bağlantılar yükleniyor…');
    friends.append(friendsHead, friendList);
    aside.append(friends);
    const privacy = el('section', 'privacy-callout');
    privacy.append(el('strong', '', 'Gizlilik senin kontrolünde.'), document.createTextNode(' Bu sayfa hesabına özeldir. Paylaşımı açarsan özetin ve bağlantıların diğer izinli üyelere görünür; paylaşım iznini geri almak için onay kutusunu kapatıp kaydet.'));
    aside.append(privacy);
    grid.append(main, aside);
    page.append(grid);
    root.append(page);

    for (let index = 0; index < 5; index++) {
      const row = el('div', 'link-row-editor');
      const label = makeTextInput({ name: `link-label-${index}`, placeholder: 'Bağlantı adı', maxLength: 60, className: 'control-input' });
      const url = makeTextInput({ name: `link-url-${index}`, placeholder: 'https://…', maxLength: 300, type: 'url', className: 'control-input' });
      row.append(label, url);
      linkEditor.append(row);
    }
    consent.addEventListener('change', () => { closedWrap.hidden = !consent.checked; if (!consent.checked) closed.checked = false; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const links = [];
      for (const row of $$('.link-row-editor', linkEditor)) {
        const [label, url] = $$('input', row);
        const cleanLabel = label.value.trim();
        const cleanUrl = url.value.trim();
        if (cleanLabel || cleanUrl) {
          if (!cleanLabel || !cleanUrl || !safeHttpUrl(cleanUrl)) {
            showToast('Her bağlantı için geçerli bir ad ve http(s) adresi gir.', true);
            return;
          }
          links.push({ label: cleanLabel, url: cleanUrl });
        }
      }
      submit.disabled = true;
      try {
        await api('/api/support-pack', { method: 'POST', body: {
          summary: summary.value.trim(), links, approved: consent.checked, closed: consent.checked && closed.checked,
        } });
        showToast('Destek çantan güncellendi.');
        await loadFriendLinks(friendList, consent.checked && !closed.checked);
      } catch (error) { showToast(error.message || 'Değişiklikler kaydedilemedi.', true); }
      finally { submit.disabled = false; }
    });

    try {
      const result = await api('/api/support-pack/me');
      const pack = result.pack;
      if (!root.isConnected) return;
      if (pack) {
        summary.value = pack.summary || '';
        consent.checked = Boolean(pack.approved);
        closed.checked = Boolean(pack.closed);
        closedWrap.hidden = !consent.checked;
        const rows = $$('.link-row-editor', linkEditor);
        (pack.links || []).slice(0, 5).forEach((link, index) => {
          const inputs = $$('input', rows[index]);
          inputs[0].value = link.label || '';
          inputs[1].value = link.url || '';
        });
      } else closedWrap.hidden = true;
      await loadFriendLinks(friendList, Boolean(pack?.approved && !pack?.closed));
    } catch (error) {
      setEmpty(friendList, error.message || 'Destek çantası yüklenemedi.', true);
    }
  }

  async function loadFriendLinks(container, canView) {
    container.replaceChildren();
    if (!canView) {
      container.append(el('div', 'empty-state', 'Topluluk bağlantılarını görmek için paylaşım iznini açman gerekir. Bu tercih isteğe bağlıdır.'));
      return;
    }
    setEmpty(container, 'Paylaşılan bağlantılar yükleniyor…');
    try {
      const result = await api('/api/support-pack/approved-links');
      if (!container.isConnected) return;
      container.replaceChildren();
      if (!result.list.length) {
        container.append(el('div', 'empty-state', 'Henüz bağlantı paylaşan üye yok.'));
        return;
      }
      result.list.forEach((person) => {
        const card = el('article', 'friend-card');
        card.append(el('h3', '', person.rumuz || 'Topluluk üyesi'));
        if (person.summary) card.append(el('p', '', person.summary));
        const links = el('div', 'friend-links');
        (person.links || []).forEach((link) => {
          const url = safeHttpUrl(link.url);
          if (!url) return;
          const anchor = el('a', '', `${link.label || 'Bağlantı'} ↗`);
          anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
          links.append(anchor);
        });
        if (links.childElementCount) card.append(links);
        container.append(card);
      });
    } catch (error) {
      if (container.isConnected) setEmpty(container, error.message || 'Bağlantılar yüklenemedi.', true);
    }
  }

  // Resources
  async function renderResources(root) {
    const page = el('div');
    page.append(pageHeading('GÜVENİLİR BİLGİ', 'Kaynaklar ve destek hatları', 'Kurumların iletişim bilgileri zamanla değişebilir. Aramadan veya başvurmadan önce güncel bilgiyi kurumun resmî kanallarından doğrula.'));
    const grid = el('div', 'resource-grid');
    setEmpty(grid, 'Kaynaklar yükleniyor…');
    page.append(grid);
    const note = el('div', 'inline-alert resources-disclaimer');
    note.append(el('span', '', 'ⓘ'), el('span', '', 'Bu liste bilgilendirme ve yönlendirme amaçlıdır; SPEKTRUM acil hizmet sunmaz. Acil tehlikede 112’yi ara.'));
    page.append(note);
    root.append(page);
    try {
      const result = await api('/api/resources');
      if (!grid.isConnected) return;
      grid.replaceChildren();
      if (!result.resources.length) { setEmpty(grid, 'Henüz kaynak eklenmemiş.'); return; }
      result.resources.forEach((resource) => {
        const card = el('article', 'resource-card');
        const top = el('div', 'resource-card-top');
        top.append(el('h2', '', resource.title), el('span', 'pill', CATEGORY_LABELS[resource.category] || 'Kaynak'));
        const description = el('p', '', resource.description || '');
        const bottom = el('div', 'resource-card-bottom');
        const url = safeHttpUrl(resource.url);
        if (url) {
          const anchor = el('a', '', 'Resmî siteye git ↗');
          anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
          bottom.append(anchor);
        }
        const tel = phoneHref(resource.phone);
        if (tel) {
          const phone = el('a', 'resource-phone', `☎ ${resource.phone}`);
          phone.href = tel;
          bottom.append(phone);
        } else if (resource.phone) bottom.append(el('span', 'resource-phone', `Telefon: ${resource.phone}`));
        card.append(top, description, bottom);
        grid.append(card);
      });
    } catch (error) { if (grid.isConnected) setEmpty(grid, error.message || 'Kaynaklar yüklenemedi.', true); }
  }

  // Profile
  function renderProfile(root) {
    const page = el('div');
    page.append(pageHeading('HESABIN', 'Profil ayarları', 'Görünür bilgilerini ve toplulukta kullandığın rumuzu yönet.'));
    const grid = el('div', 'profile-grid');
    const card = el('section', 'surface profile-form-card');
    const head = el('div', 'surface-heading');
    const copy = el('div'); copy.append(el('h2', '', 'Görünür profil'), el('p', '', 'Rumuzun toplulukta görünür; e-posta adresin diğer üyelere gösterilmez.'));
    head.append(copy);
    const form = el('form', 'form-grid');
    const rumuz = makeTextInput({ name: 'rumuz', maxLength: 30, value: state.user.rumuz, required: true }); rumuz.minLength = 2;
    const name = makeTextInput({ name: 'name', maxLength: 40, value: state.user.name, required: true }); name.minLength = 2;
    const area = el('select', 'control-select'); area.name = 'supportArea';
    [['', 'Seçmek istemiyorum'], ['psikolojik', 'Psikolojik destek'], ['hukuk', 'Hukuki danışmanlık'], ['topluluk', 'Topluluk ve sosyal ağ'], ['barinma', 'Güvenli barınma'], ['gonullu', 'Gönüllülük'], ['diger', 'Diğer']].forEach(([value, label]) => {
      const option = el('option', '', label); option.value = value; area.append(option);
    });
    area.value = state.user.supportArea || '';
    form.append(makeField('Toplulukta görünen rumuz', rumuz), makeField('Adın', name), makeField('İlgilendiğin alan', area));
    const actions = el('div', 'form-actions span-full');
    actions.append(el('p', 'form-hint', 'İstediğin zaman yeniden değiştirebilirsin.'), button('Profili kaydet →', 'button button-primary', null, 'submit'));
    form.append(actions);
    card.append(head, form);

    const aside = el('aside');
    const details = el('section', 'account-details');
    const detailHead = el('div'); detailHead.append(el('h2', '', 'Hesap bilgileri'));
    details.append(detailHead);
    const detailsList = [
      ['E-posta', state.user.email || '—'],
      ['Giriş yöntemi', state.user.provider === 'google' ? 'Google hesabı' : 'E-posta ve parola'],
      ['Hesap türü', state.user.role === 'counselor' ? 'Uzman destek hesabı' : 'Topluluk üyesi'],
    ];
    detailsList.forEach(([label, value]) => {
      const row = el('div', 'account-detail'); row.append(el('span', '', label), el('strong', '', value)); details.append(row);
    });
    const note = el('div', 'profile-note');
    note.append(el('strong', '', 'Küçük bir güvenlik hatırlatması'), document.createTextNode(' Parolanı başka kişilerle paylaşma. Kullandığın cihaz ortaksa işin bitince çıkış yap.'));
    aside.append(details, note);
    grid.append(card, aside);
    page.append(grid);
    root.append(page);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const result = await api('/api/me', { method: 'PATCH', body: {
          name: name.value.trim(), rumuz: rumuz.value.trim(), supportArea: area.value || null,
        } });
        state.user = result.user;
        updateSidebar();
        showToast('Profilin güncellendi.');
      } catch (error) { showToast(error.message || 'Profil güncellenemedi.', true); }
      finally { submit.disabled = false; }
    });
  }

  // Notifications
  function openNotifications() {
    const panel = $('#notification-panel');
    state.notificationOpen = true;
    panel.hidden = false;
    $('#notification-toggle').setAttribute('aria-expanded', 'true');
    loadNotifications();
  }

  function closeNotifications() {
    const panel = $('#notification-panel');
    if (!panel) return;
    state.notificationOpen = false;
    panel.hidden = true;
    $('#notification-toggle').setAttribute('aria-expanded', 'false');
  }

  async function loadNotifications() {
    const list = $('#notification-list');
    setEmpty(list, 'Bildirimler yükleniyor…');
    try {
      const result = await api('/api/notifications');
      list.replaceChildren();
      if (!result.notifications.length) list.append(el('div', 'empty-state', 'Henüz bildirimin yok.'));
      result.notifications.forEach((notification) => {
        const item = button('', `notification-item${notification.read_at ? '' : ' is-unread'}`, () => openNotification(notification));
        item.append(el('strong', '', notification.title));
        if (notification.body) item.append(el('p', '', notification.body));
        item.append(el('time', '', formatDate(notification.created_at, true)));
        list.append(item);
      });
      setNotificationBadge(result.unread);
    } catch (error) { setEmpty(list, error.message || 'Bildirimler yüklenemedi.', true); }
  }

  function setNotificationBadge(count) {
    const dot = $('#notification-dot');
    dot.hidden = Number(count) < 1;
    $('#notification-toggle').setAttribute('aria-label', Number(count) > 0 ? `Bildirimler, ${count} okunmamış` : 'Bildirimler');
  }

  async function refreshBadges() {
    const tasks = [api('/api/notifications/unread-count'), api('/api/chat/unread-count')];
    const [notifications, chats] = await Promise.allSettled(tasks);
    if (notifications.status === 'fulfilled') setNotificationBadge(notifications.value.count);
    if (chats.status === 'fulfilled') {
      const badge = $('#chat-badge');
      const count = Number(chats.value.count) || 0;
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.hidden = count < 1;
    }
  }

  async function openNotification(notification) {
    closeNotifications();
    if (!notification.read_at) {
      api(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: 'POST', body: {} }).catch(() => {});
    }
    if (notification.type === 'dm') {
      await showPage('chat');
      const conversation = state.chat.conversations.find((item) => item.id === notification.link);
      await openChat({ id: notification.link, type: 'dm', peer: conversation?.peer });
    } else if (notification.type === 'support_msg') {
      await showPage('chat');
      if (state.user.role === 'counselor') {
        const conversation = state.chat.inbox.find((item) => item.id === notification.link);
        await openChat({ id: notification.link, type: 'support', peer: conversation?.owner, title: conversation?.owner?.rumuz, subtitle: 'Danışanla özel destek kanalı' });
      } else {
        state.chat.supportId = notification.link;
        await openChat({ id: notification.link, type: 'support', title: 'Psikolojik destek', subtitle: 'Özel kanal · Yalnızca sen ve yetkili uzman ekibi' });
      }
    } else if (notification.type === 'support_request' || notification.type === 'request_status') {
      await showPage('support');
    } else {
      state.category = 'tumu';
      state.focusPostId = notification.link;
      await showPage('wall');
    }
    void refreshBadges();
  }

  async function markAllNotificationsRead() {
    try {
      await api('/api/notifications/read-all', { method: 'POST', body: {} });
      await loadNotifications();
    } catch (error) { showToast(error.message || 'Bildirimler güncellenemedi.', true); }
  }

  // App shell events
  document.addEventListener('click', (event) => {
    const pageControl = event.target.closest('[data-page]');
    if (pageControl) { showPage(pageControl.dataset.page); return; }
    const actionControl = event.target.closest('[data-action]');
    if (actionControl) {
      if (actionControl.dataset.action === 'quick-exit') window.location.replace('https://www.google.com/search?q=hava+durumu');
      else if (actionControl.dataset.action === 'profile') showPage('profile');
      return;
    }
    if (state.notificationOpen && !event.target.closest('.notification-wrap')) closeNotifications();
  });

  $('#menu-toggle').addEventListener('click', () => {
    const sidebar = $('#portal-sidebar');
    const open = !sidebar.classList.contains('is-open');
    sidebar.classList.toggle('is-open', open);
    $('#mobile-scrim').hidden = !open;
    $('#menu-toggle').setAttribute('aria-expanded', String(open));
  });
  $('#mobile-scrim').addEventListener('click', closeSidebar);
  $('#notification-toggle').addEventListener('click', () => {
    if (state.notificationOpen) closeNotifications();
    else openNotifications();
  });
  $('#mark-all-read').addEventListener('click', markAllNotificationsRead);
  $('#logout-button').addEventListener('click', async () => {
    const logout = $('#logout-button');
    logout.disabled = true;
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* Leave the app even if the network is unavailable. */ }
    window.location.replace('/');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeNotifications(); closeSidebar(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { void refreshBadges(); if (state.page === 'chat') { void loadChatDirectory(); void refreshCurrentChat(); } }
  });

  async function initialize() {
    try {
      const result = await api('/api/me');
      state.user = result.user;
      updateSidebar();
      await showPage('home');
      await refreshBadges();
      setInterval(async () => {
        if (document.hidden || state.redirecting || state.pollBusy) return;
        state.pollBusy = true;
        try {
          await refreshBadges();
          if (state.notificationOpen) await loadNotifications();
          if (state.page === 'chat') {
            await refreshCurrentChat();
            await loadChatDirectory();
          }
        } finally { state.pollBusy = false; }
      }, 7000);
    } catch (error) {
      if (!state.redirecting) {
        const content = $('#page-content');
        setEmpty(content, error.message || 'Oturum açılamadı. Lütfen yeniden giriş yap.', true);
      }
    }
  }

  void initialize();
})();
