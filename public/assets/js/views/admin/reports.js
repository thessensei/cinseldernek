import { api, withQuery } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { formatShortDate, formatTime, REPORT_REASON_LABELS } from '../../core/format.js';
import { isCurrent } from '../../core/router.js';
import { isAdmin, store } from '../../core/store.js';
import { refreshReportCount } from '../../core/sync.js';
import { adminFrame } from './frame.js';
import { confirmDialog, toast } from '../../components/feedback.js';
import { errorText, loading, pager } from '../../components/ui.js';

const TABS = [
  ['open', 'Açık'],
  ['resolved', 'Çözüldü'],
  ['dismissed', 'Reddedildi'],
  ['all', 'Tümü'],
];
const ACTION_LABELS = { mesaj_silindi: 'mesaj silindi', kullanici_yasaklandi: 'kullanıcı yasaklandı' };
const STATUS_LABELS = { open: 'Açık', resolved: 'Çözüldü', dismissed: 'Reddedildi' };

function contextLine(item, target) {
  return h(
    'div',
    { class: `context-item${target ? ' target' : ''}` },
    h('span', { class: 'who' }, item.author?.displayName ?? 'Silinmiş üye'),
    h('span', { class: 'snapshot-msg' }, item.deleted ? '(silinmiş)' : item.body || '(boş)'),
    h('span', { class: 'when' }, formatTime(item.createdAt)),
  );
}

function reportCard(report, reload) {
  const snapshot = report.snapshot || {};
  const message = snapshot.message;
  const open = report.status === 'open';
  const admin = isAdmin(store.state.user);
  const note = h('input', { class: 'input', placeholder: 'Karar notu (isteğe bağlı)', maxlength: 500, 'aria-label': 'Karar notu' });

  const resolve = async (payload, confirmation) => {
    if (confirmation) {
      const ok = await confirmDialog({ title: 'Onay gerekli', message: confirmation, confirmLabel: 'Onayla', danger: true });
      if (!ok) return;
    }
    try {
      await api.post(`/api/admin/reports/${report.id}/resolve`, { ...payload, note: note.value.trim() || undefined });
      toast('Şikayet sonuçlandırıldı.', 'success');
      refreshReportCount();
      reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const canDeleteMessage = Boolean(message && !report.messageDeleted && report.messageId);
  const reported = report.reportedUser;
  const canBan = Boolean(reported && reported.status !== 'banned' && reported.status !== 'deleted' && (reported.role === 'user' || admin));

  const actions = [];
  if (open) {
    if (canDeleteMessage) {
      actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => resolve({ outcome: 'resolved', deleteMessage: true }, 'Mesaj herkes için silinecek.') }, 'Mesajı sil'));
    }
    if (canBan) {
      actions.push(h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => resolve({ outcome: 'resolved', banUser: true }, `${reported.displayName} yasaklanacak ve çıkış yapacak.`) }, 'Kullanıcıyı yasakla'));
    }
    if (canDeleteMessage && canBan) {
      actions.push(h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => resolve({ outcome: 'resolved', deleteMessage: true, banUser: true }, 'Mesaj silinecek ve kullanıcı yasaklanacak.') }, 'Mesajı sil ve yasakla'));
    }
    actions.push(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => resolve({ outcome: 'dismissed' }, 'Şikayet geçersiz sayılıp reddedilecek.') }, 'Reddet'));
  }

  const resolution = report.resolution
    ? h(
        'p',
        { class: 'faint small', style: { marginTop: '0.6rem' } },
        `Sonuç: ${(report.resolution.actions || []).map((a) => ACTION_LABELS[a] ?? a).join(', ') || 'işlem uygulanmadı'}${report.resolution.note ? ` · Not: ${report.resolution.note}` : ''}`,
      )
    : null;

  const contextBlock = message
    ? h(
        'div',
        { class: 'context' },
        (snapshot.context || []).map((item) => contextLine(item, false)),
        contextLine({ ...message, body: message.body, deleted: report.messageDeleted ?? message.deleted }, true),
      )
    : snapshot.user
      ? h('p', { class: 'muted small' }, `Üye profili şikayet edildi: @${snapshot.user.username}`)
      : null;

  return h(
    'article',
    { class: 'report-card' },
    h(
      'div',
      { class: 'row-between' },
      h('h3', null, REPORT_REASON_LABELS[report.reason] ?? report.reason),
      h('span', { class: 'row' }, h('span', { class: `badge ${open ? 'badge-danger' : report.status === 'resolved' ? 'badge-ok' : 'badge-muted'}` }, STATUS_LABELS[report.status]), h('span', { class: 'faint small' }, formatShortDate(report.createdAt))),
    ),
    h(
      'p',
      { class: 'small muted' },
      'Şikayet eden: ',
      report.reporter ? h('a', { href: `/admin/users?q=${encodeURIComponent(report.reporter.username)}` }, `@${report.reporter.username}`) : 'silinmiş hesap',
      ' · Hedef: ',
      reported ? h('a', { href: `/admin/users?q=${encodeURIComponent(reported.username)}` }, `${reported.displayName} (@${reported.username})`) : 'silinmiş hesap',
      reported?.status === 'banned' ? h('span', { class: 'badge badge-danger', style: { marginLeft: '0.4rem' } }, 'Yasaklı') : null,
    ),
    report.details ? h('p', { class: 'muted', style: { marginTop: '0.5rem', whiteSpace: 'pre-wrap' } }, `“${report.details}”`) : null,
    contextBlock,
    message
      ? h('p', { class: 'faint small', style: { marginTop: '0.5rem' } }, `Kapsam: ${snapshot.scope === 'dm' ? 'özel mesaj' : 'oda mesajı'} · Yalnızca bu şikayet için kaydedilen anlık görüntü gösterilir.`)
      : null,
    open && actions.length ? h('div', { class: 'report-actions' }, note, ...actions) : null,
    resolution,
  );
}

export async function renderReports({ query, id }) {
  const content = adminFrame('reports', 'Şikayetler');
  const state = { status: query.get('status') || 'open', page: 1, limit: 10 };
  const tabRow = h('div', { class: 'tabs-inline', role: 'tablist', 'aria-label': 'Şikayet durumu' });
  const listHost = h('div', null, loading());
  const pagerHost = h('div');

  function paintTabs() {
    tabRow.replaceChildren(
      ...TABS.map(([value, label]) =>
        h('button', {
          class: 'chip',
          type: 'button',
          role: 'tab',
          'aria-pressed': String(state.status === value),
          onclick: () => {
            state.status = value;
            state.page = 1;
            paintTabs();
            load();
          },
        }, label),
      ),
    );
  }

  async function load() {
    try {
      const data = await api.get(withQuery('/api/admin/reports', { status: state.status === 'all' ? '' : state.status, page: state.page, limit: state.limit }));
      if (!isCurrent(id)) return;
      listHost.replaceChildren(
        ...(data.reports.length ? data.reports.map((report) => reportCard(report, load)) : [h('div', { class: 'empty' }, state.status === 'open' ? 'Bekleyen şikayet yok. Topluluk iyi görünüyor 🌈' : 'Bu filtrede şikayet bulunmuyor.')]),
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
      listHost.replaceChildren(h('p', { class: 'form-error' }, errorText(err)));
    }
  }

  paintTabs();
  content.replaceChildren(
    h('h1', null, 'Şikayetler'),
    h('p', { class: 'lead' }, 'Mesajlar yalnızca şikayet anındaki kayıtla gösterilir. Özel mesajların içeriği şikayet dışında görüntülenmez.'),
    tabRow,
    listHost,
    pagerHost,
  );
  await load();
}
