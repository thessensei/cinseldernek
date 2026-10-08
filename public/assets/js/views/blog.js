import { api, withQuery } from '../core/api.js';
import { h } from '../core/dom.js';
import { formatShortDate } from '../core/format.js';
import { isCurrent } from '../core/router.js';
import { isStaff, store } from '../core/store.js';
import { mountShell, setTitle } from '../components/layout.js';
import { avatar, emptyState, errorText, loading, pageHeader } from '../components/ui.js';
import { confirmDialog, toast } from '../components/feedback.js';
import { debounce } from '../core/dom.js';

const PAGE_SIZE = 9;

function shellFor() {
  return mountShell(store.state.user ? 'app' : 'public', 'blog');
}

function postCard(post) {
  return h(
    'a',
    { class: 'post-card', href: `/blog/${post.slug}` },
    post.coverUrl
      ? h('img', { class: 'post-cover', src: post.coverUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
      : h('div', { class: 'post-cover-fallback', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'post-body' },
      h('h2', { class: 'post-title' }, post.title),
      post.excerpt ? h('p', { class: 'post-excerpt' }, post.excerpt) : null,
      post.tags.length ? h('div', { class: 'row' }, post.tags.map((tag) => h('span', { class: 'tag' }, tag))) : null,
      h(
        'div',
        { class: 'post-meta' },
        h('span', null, post.author?.displayName ?? 'SPEKTRUM'),
        h('span', null, '·'),
        h('time', { datetime: post.publishedAt }, formatShortDate(post.publishedAt ?? post.createdAt)),
        h('span', null, '·'),
        h('span', null, `${post.views} görüntülenme`),
      ),
    ),
  );
}

/** Yayınlanmış yazılar: arama, etiket filtresi ve sayfalama. */
export async function renderBlogList({ query, id }) {
  const main = shellFor();
  setTitle('Blog');
  const state = { q: query.get('q') || '', tag: query.get('tag') || '', page: 1, total: 0 };
  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Yazılarda ara…',
    value: state.q,
    maxlength: 100,
    'aria-label': 'Yazılarda ara',
  });
  const tagRow = h('div', { class: 'chip-row', 'aria-label': 'Etiketler' });
  const grid = h('div', { class: 'post-grid' }, loading());
  const more = h('div', { class: 'load-more' });
  const summary = h('p', { class: 'faint small', style: { marginBottom: '0.8rem' } });

  const syncUrl = () => {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.tag) params.set('tag', state.tag);
    const search2 = params.toString();
    history.replaceState({}, '', `/blog${search2 ? `?${search2}` : ''}`);
  };

  async function load(reset) {
    if (reset) {
      state.page = 1;
      grid.replaceChildren(loading());
    }
    try {
      const data = await api.get(withQuery('/api/blog/posts', { q: state.q, tag: state.tag, page: state.page, limit: PAGE_SIZE }));
      if (!isCurrent(id)) return;
      state.total = data.total;
      const posts = data.posts;
      if (reset) grid.replaceChildren(...(posts.length ? posts.map(postCard) : [emptyState('Aradığınız kriterlerde yazı bulunamadı.')]));
      else grid.append(...posts.map(postCard));
      summary.textContent = data.total ? `${data.total} yazı` : '';
      const shown = grid.querySelectorAll('.post-card').length;
      more.replaceChildren(
        shown < data.total
          ? h('button', { class: 'btn', type: 'button', onclick: () => { state.page += 1; load(false); } }, 'Daha fazla yazı')
          : null,
      );
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const applySearch = debounce(() => {
    state.q = search.value.trim();
    syncUrl();
    load(true);
  }, 350);
  search.addEventListener('input', applySearch);

  async function loadTags() {
    try {
      const { tags } = await api.get('/api/blog/tags');
      if (!isCurrent(id)) return;
      tagRow.replaceChildren(
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!state.tag), onclick: () => selectTag('') }, 'Tümü'),
        ...tags.map((item) =>
          h(
            'button',
            { class: 'chip', type: 'button', 'aria-pressed': String(state.tag === item.tag), onclick: () => selectTag(item.tag) },
            `#${item.tag} (${item.count})`,
          ),
        ),
      );
    } catch {
      tagRow.replaceChildren();
    }
  }

  function selectTag(tag) {
    state.tag = tag;
    syncUrl();
    tagRow.querySelectorAll('.chip').forEach((chip) => chip.setAttribute('aria-pressed', 'false'));
    loadTags();
    load(true);
  }

  main.replaceChildren(
    h(
      'div',
      { class: 'page-wide' },
      pageHeader({
        title: 'Blog',
        subtitle: 'Rehberler, duyurular ve dayanışma hikâyeleri.',
        actions: search,
      }),
      tagRow,
      summary,
      grid,
      more,
    ),
  );
  await Promise.all([loadTags(), load(true)]);
}

function commentNode(comment, canDelete, onDelete) {
  return h(
    'div',
    { class: 'comment' },
    avatar(comment.author ?? { displayName: '?' }, 36),
    h(
      'div',
      null,
      h(
        'div',
        { class: 'comment-head' },
        h('strong', null, comment.author?.displayName ?? 'Silinmiş üye'),
        h('span', { class: 'faint' }, formatShortDate(comment.createdAt)),
        canDelete ? h('button', { class: 'link-btn danger small', type: 'button', onclick: () => onDelete(comment) }, 'Sil') : null,
      ),
      h('div', { class: 'comment-body' }, comment.body),
    ),
  );
}

/** Tek yazı: içerik, yorumlar ve yorum formu. */
export async function renderBlogPost({ params, id }) {
  const main = shellFor();
  main.replaceChildren(h('div', { class: 'page-narrow' }, loading()));
  let post;
  try {
    ({ post } = await api.get(`/api/blog/posts/${encodeURIComponent(params.slug)}`));
  } catch (err) {
    if (!isCurrent(id)) return;
    main.replaceChildren(
      h(
        'div',
        { class: 'page-narrow' },
        emptyState(err.status === 404 ? 'Aradığınız yazı bulunamadı veya yayından kaldırıldı.' : errorText(err)),
        h('p', { class: 'row', style: { justifyContent: 'center' } }, h('a', { class: 'btn', href: '/blog' }, '← Bloga dön')),
      ),
    );
    return;
  }
  if (!isCurrent(id)) return;
  setTitle(post.title);

  const prose = h('div', { class: 'prose' });
  // Sunucu markdown'ı html:false ile işler; ham HTML etiketleri kaçışlanmış olarak gelir.
  prose.innerHTML = post.html;

  const me = store.state.user;
  const commentList = h('div', { class: 'stack', 'aria-live': 'polite' }, loading('Yorumlar yükleniyor…'));
  const commentCount = h('h2', { class: 'card-title' }, 'Yorumlar');

  const removeComment = async (comment) => {
    const ok = await confirmDialog({ title: 'Yorumu sil', message: 'Bu yorum kaldırılacak.', confirmLabel: 'Sil', danger: true });
    if (!ok) return;
    try {
      await api.del(`/api/blog/comments/${comment.id}`);
      loadComments();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  async function loadComments() {
    try {
      const { comments } = await api.get(`/api/blog/posts/${post.slug}/comments`);
      if (!isCurrent(id)) return;
      commentCount.textContent = `Yorumlar (${comments.length})`;
      commentList.replaceChildren(
        ...(comments.length
          ? comments.map((c) => commentNode(c, Boolean(me) && (c.authorId === me.id || isStaff(me)), removeComment))
          : [h('p', { class: 'faint small' }, 'Henüz yorum yok. İlk yorumu sen yaz.')]),
      );
    } catch (err) {
      commentList.replaceChildren(h('p', { class: 'form-error' }, errorText(err)));
    }
  }

  const commentSection = h('section', { class: 'comments' }, commentCount, commentList);
  if (me) {
    const textarea = h('textarea', { class: 'textarea', rows: 3, maxlength: 1000, placeholder: 'Düşüncelerini paylaş… (saygılı bir dil kullanalım)', 'aria-label': 'Yorumunuz' });
    const error = h('div', { class: 'form-error', role: 'alert' });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Yorumu gönder');
    const form = h('form', { class: 'form', style: { marginTop: '1rem' } }, textarea, error, h('div', { class: 'form-actions' }, submit));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const body = textarea.value.trim();
      if (!body) {
        error.textContent = 'Yorum boş olamaz.';
        return;
      }
      submit.disabled = true;
      try {
        await api.post(`/api/blog/posts/${post.slug}/comments`, { body });
        textarea.value = '';
        await loadComments();
      } catch (err) {
        error.textContent = errorText(err);
      } finally {
        submit.disabled = false;
      }
    });
    commentSection.append(form);
  } else {
    commentSection.append(
      h(
        'p',
        { class: 'muted', style: { marginTop: '1rem' } },
        'Yorum yapmak için ',
        h('a', { href: `/login?next=${encodeURIComponent(`/blog/${post.slug}`)}` }, 'giriş yapın'),
        '.',
      ),
    );
  }

  const article = h(
    'article',
    { class: 'article' },
    post.coverUrl ? h('img', { class: 'article-cover', src: post.coverUrl, alt: '', referrerpolicy: 'no-referrer' }) : null,
    h('h1', { class: 'article-title' }, post.title),
    h(
      'div',
      { class: 'article-meta' },
      h('span', { class: 'row' }, avatar(post.author ?? { displayName: 'S' }, 28), post.author?.displayName ?? 'SPEKTRUM'),
      h('span', null, formatShortDate(post.publishedAt ?? post.createdAt)),
      h('span', null, `${post.views} görüntülenme`),
      post.tags.length ? h('span', { class: 'row' }, post.tags.map((tag) => h('span', { class: 'tag' }, tag))) : null,
    ),
    prose,
    h('p', { class: 'row', style: { marginTop: '2rem' } }, h('a', { class: 'btn btn-ghost btn-sm', href: '/blog' }, '← Tüm yazılar')),
    commentSection,
  );

  main.replaceChildren(h('div', { class: 'page-narrow' }, article));
  loadComments();
}
