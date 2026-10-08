import { api, withQuery } from '../../core/api.js';
import { debounce, h } from '../../core/dom.js';
import { formatShortDate } from '../../core/format.js';
import { isCurrent, navigate } from '../../core/router.js';
import { adminFrame } from './frame.js';
import { confirmDialog, toast } from '../../components/feedback.js';
import { errorText, field, formError, loading, pager, selectField, setFormError, table } from '../../components/ui.js';

const STATUS_LABEL = { draft: 'Taslak', published: 'Yayında' };

export async function renderPostList({ query, id }) {
  const content = adminFrame('posts', 'Blog');
  const state = { status: query.get('status') || '', q: query.get('q') || '', page: 1, limit: 20 };
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Başlıkta ara…', value: state.q, 'aria-label': 'Yazılarda ara' });
  const statusFilter = h(
    'select',
    { class: 'select', 'aria-label': 'Durum filtresi' },
    [['', 'Tüm yazılar'], ['published', 'Yayında'], ['draft', 'Taslak']].map(([value, label]) => h('option', { value, selected: value === state.status }, label)),
  );
  const tableHost = h('div', null, loading());
  const pagerHost = h('div');

  async function remove(post) {
    const ok = await confirmDialog({ title: 'Yazıyı sil', message: `"${post.title}" kalıcı olarak silinecek.`, confirmLabel: 'Sil', danger: true });
    if (!ok) return;
    try {
      await api.del(`/api/admin/posts/${post.id}`);
      toast('Yazı silindi.', 'success');
      load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function load() {
    try {
      const data = await api.get(withQuery('/api/admin/posts', { q: state.q, status: state.status, page: state.page, limit: state.limit }));
      if (!isCurrent(id)) return;
      tableHost.replaceChildren(
        table({
          columns: [
            {
              label: 'Başlık',
              render: (post) => h('a', { href: `/admin/posts/${post.id}` }, post.title),
            },
            {
              label: 'Durum',
              render: (post) => h('span', { class: `badge ${post.status === 'published' ? 'badge-ok' : 'badge-warn'}` }, STATUS_LABEL[post.status]),
            },
            { label: 'Etiketler', render: (post) => (post.tags.length ? post.tags.join(', ') : '—') },
            { label: 'Görüntülenme', render: (post) => String(post.views) },
            { label: 'Tarih', render: (post) => formatShortDate(post.publishedAt ?? post.createdAt) },
            {
              label: '',
              className: 'actions',
              render: (post) =>
                h(
                  'span',
                  { class: 'row', style: { justifyContent: 'flex-end' } },
                  post.status === 'published' ? h('a', { class: 'btn btn-sm btn-ghost', href: `/blog/${post.slug}`, target: '_blank', rel: 'noopener' }, 'Görüntüle') : null,
                  h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => remove(post) }, 'Sil'),
                ),
            },
          ],
          rows: data.posts,
          empty: 'Henüz yazı yok. "Yeni yazı" ile ilkini oluşturun.',
        }),
      );
      pagerHost.replaceChildren(
        pager({
          page: state.page,
          limit: state.limit,
          total: data.total,
          onChange: (page) => {
            state.page = page;
            load();
          },
        }),
      );
    } catch (err) {
      tableHost.replaceChildren(h('p', { class: 'form-error' }, errorText(err)));
    }
  }

  search.addEventListener(
    'input',
    debounce(() => {
      state.q = search.value.trim();
      state.page = 1;
      load();
    }, 350),
  );
  statusFilter.addEventListener('change', () => {
    state.status = statusFilter.value;
    state.page = 1;
    load();
  });

  content.replaceChildren(
    h('div', { class: 'row-between', style: { marginBottom: '0.4rem' } }, h('h1', null, 'Blog'), h('a', { class: 'btn btn-primary', href: '/admin/posts/new' }, '+ Yeni yazı')),
    h('p', { class: 'lead' }, 'Yazıları taslak olarak hazırlayın, hazır olduğunda yayınlayın.'),
    h('div', { class: 'toolbar-admin' }, search, statusFilter),
    tableHost,
    pagerHost,
  );
  await load();
}

export async function renderPostEditor({ postId, id }) {
  const content = adminFrame(postId ? 'Yazı düzenle' : 'Yeni yazı', 'Blog');
  let post = null;
  if (postId) {
    try {
      ({ post } = await api.get(`/api/admin/posts/${postId}`));
    } catch (err) {
      if (isCurrent(id)) content.replaceChildren(h('p', { class: 'form-error' }, errorText(err)));
      return;
    }
  }
  if (!isCurrent(id)) return;

  const title = field({ label: 'Başlık', name: 'title', value: post?.title ?? '', required: true, maxlength: 150 });
  const slug = field({ label: 'Bağlantı adı (slug)', name: 'slug', value: post?.slug ?? '', maxlength: 80, hint: 'Boş bırakılırsa başlıktan üretilir.' });
  const excerpt = field({ label: 'Özet', name: 'excerpt', value: post?.excerpt ?? '', maxlength: 300 });
  const cover = field({ label: 'Kapak görseli bağlantısı', name: 'coverUrl', value: post?.coverUrl ?? '', placeholder: 'https://…', maxlength: 500, hint: 'İsteğe bağlı. https:// ile başlamalı.' });
  const tags = field({ label: 'Etiketler', name: 'tags', value: (post?.tags ?? []).join(', '), placeholder: 'rehber, güvenlik', hint: 'Virgülle ayırın (en fazla 10).' });
  const status = selectField({ label: 'Durum', name: 'status', options: [['draft', 'Taslak'], ['published', 'Yayında']], value: post?.status ?? 'draft' });
  const body = h('textarea', {
    class: 'textarea',
    name: 'bodyMd',
    rows: 22,
    maxlength: 60000,
    'aria-label': 'Markdown içerik',
    placeholder: '# Başlık\n\nİçeriğinizi markdown ile yazın…',
  }, post?.bodyMd ?? '');
  const preview = h('div', { class: 'preview', 'aria-live': 'polite' });
  if (post?.html) preview.innerHTML = post.html;
  else preview.append(h('p', { class: 'faint' }, 'Önizleme burada görünecek.'));

  // Sunucu markdown'ı html:false ile işler; önizleme de aynı güvenli çıktıyı gösterir.
  const refreshPreview = debounce(async () => {
    try {
      const { html } = await api.post('/api/admin/markdown', { body: body.value });
      preview.innerHTML = html;
    } catch {
      // Önizleme geçici olarak kullanılamayabilir.
    }
  }, 350);
  body.addEventListener('input', refreshPreview);

  const error = formError();
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, post ? 'Değişiklikleri kaydet' : 'Yazıyı oluştur');
  const payload = () => ({
    title: title.input.value.trim(),
    slug: slug.input.value.trim(),
    excerpt: excerpt.input.value.trim(),
    coverUrl: cover.input.value.trim() || null,
    tags: tags.input.value.split(',').map((tag) => tag.trim()).filter(Boolean),
    status: status.input.value,
    bodyMd: body.value,
  });
  save.addEventListener('click', async () => {
    setFormError(error, '');
    save.disabled = true;
    try {
      if (post) {
        await api.put(`/api/admin/posts/${post.id}`, payload());
        toast('Yazı kaydedildi.', 'success');
        navigate(`/admin/posts/${post.id}`, { replace: true });
      } else {
        const { post: created } = await api.post('/api/admin/posts', payload());
        toast('Yazı oluşturuldu.', 'success');
        navigate(`/admin/posts/${created.id}`, { replace: true });
      }
    } catch (err) {
      setFormError(error, errorText(err));
      save.disabled = false;
    }
  });

  const remove = post
    ? h(
        'button',
        {
          class: 'btn btn-danger',
          type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({ title: 'Yazıyı sil', message: `"${post.title}" kalıcı olarak silinecek.`, confirmLabel: 'Sil', danger: true });
            if (!ok) return;
            try {
              await api.del(`/api/admin/posts/${post.id}`);
              toast('Yazı silindi.', 'success');
              navigate('/admin/posts', { replace: true });
            } catch (err) {
              toast(errorText(err), 'error');
            }
          },
        },
        'Yazıyı sil',
      )
    : null;

  content.replaceChildren(
    h('div', { class: 'row-between', style: { marginBottom: '0.6rem' } }, h('h1', null, post ? 'Yazı düzenle' : 'Yeni yazı'), h('a', { class: 'btn btn-ghost btn-sm', href: '/admin/posts' }, '← Yazılar')),
    h(
      'div',
      { class: 'editor-grid' },
      h(
        'div',
        { class: 'stack' },
        h('div', { class: 'form-row' }, title.wrap, status.wrap),
        h('div', { class: 'form-row' }, slug.wrap, tags.wrap),
        excerpt.wrap,
        cover.wrap,
        h('div', { class: 'field' }, h('label', { for: 'post-body' }, 'İçerik (Markdown)'), Object.assign(body, { id: 'post-body' })),
        error,
        h('div', { class: 'form-actions' }, remove, save),
      ),
      h('div', null, h('div', { class: 'preview-label' }, 'Canlı önizleme'), preview),
    ),
  );
  if (post?.status === 'published') {
    content.querySelector('h1').after(h('p', { class: 'muted small' }, `Yayında · ${post.views} görüntülenme · `, h('a', { href: `/blog/${post.slug}`, target: '_blank', rel: 'noopener' }, 'Yazıyı görüntüle')));
  }
}
