import { api } from './core/api.js';
import { installLinkInterceptor, navigate, resolve, route, setNotFound } from './core/router.js';
import { on, store } from './core/store.js';
import { startRealtime, stopRealtime } from './core/realtime.js';
import { initSync, refreshAll, refreshReportCount } from './core/sync.js';
import { toast } from './components/feedback.js';
import { renderLanding } from './views/landing.js';
import { renderChat } from './views/chat.js';
import { renderBlogList, renderBlogPost } from './views/blog.js';
import { renderProfile } from './views/profile.js';
import { renderNotFound } from './views/notfound.js';
import { renderDashboard } from './views/admin/dashboard.js';
import { renderUsers } from './views/admin/users.js';
import { renderPostList, renderPostEditor } from './views/admin/posts.js';
import { renderReports } from './views/admin/reports.js';
import { renderRooms } from './views/admin/rooms.js';
import { renderAudit } from './views/admin/audit.js';
import { renderSettings } from './views/admin/settings.js';
import { initAdminBadge } from './views/admin/frame.js';

route('/', {}, (ctx) => renderLanding({ tab: 'login', next: ctx.query.get('next') || '' }));
route('/login', { auth: 'guest' }, (ctx) => renderLanding({ tab: 'login', next: ctx.query.get('next') || '' }));
route('/register', { auth: 'guest' }, (ctx) => renderLanding({ tab: 'register', next: ctx.query.get('next') || '' }));
route('/blog', {}, (ctx) => renderBlogList(ctx));
route('/blog/:slug', {}, (ctx) => renderBlogPost(ctx));
route('/app', { auth: 'user' }, (ctx) => renderChat({ mode: 'home' }, ctx.id));
route('/app/room/:slug', { auth: 'user' }, (ctx) => renderChat({ mode: 'room', slug: ctx.params.slug }, ctx.id));
route('/app/dm/:id', { auth: 'user' }, (ctx) => renderChat({ mode: 'dm', id: ctx.params.id }, ctx.id));
route('/profile', { auth: 'user' }, (ctx) => renderProfile(ctx));

route('/admin', { auth: 'staff' }, (ctx) => renderDashboard(ctx));
route('/admin/users', { auth: 'staff' }, (ctx) => renderUsers(ctx));
route('/admin/posts', { auth: 'staff' }, (ctx) => renderPostList(ctx));
route('/admin/posts/new', { auth: 'staff' }, (ctx) => renderPostEditor({ ...ctx, postId: null }));
route('/admin/posts/:id', { auth: 'staff' }, (ctx) => renderPostEditor({ ...ctx, postId: ctx.params.id }));
route('/admin/reports', { auth: 'staff' }, (ctx) => renderReports(ctx));
route('/admin/rooms', { auth: 'admin' }, (ctx) => renderRooms(ctx));
route('/admin/audit', { auth: 'admin' }, (ctx) => renderAudit(ctx));
route('/admin/settings', { auth: 'admin' }, (ctx) => renderSettings(ctx));

setNotFound(() => renderNotFound());

function clearSession(message, kind = 'warn') {
  store.set({ user: null, rooms: [], conversations: [], online: new Set(), reportsOpen: 0 });
  stopRealtime();
  if (message) toast(message, kind);
}

window.addEventListener('spektrum:unauthorized', () => {
  if (!store.state.user) return;
  clearSession('Oturumunuz sona erdi. Lütfen yeniden giriş yapın.');
  navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
});

window.addEventListener('spektrum:error', (event) => {
  toast(event.detail?.message || 'Beklenmeyen bir hata oluştu.', 'error');
});

on('revoked', (event) => {
  if (!store.state.user) return;
  const banned = event.detail?.code === 4003 || event.detail?.reason === 'banned';
  clearSession(banned ? 'Hesabınız askıya alındı. Ayrıntılar için giriş ekranına bakın.' : 'Oturumunuz sonlandırıldı.', 'error');
  navigate('/login', { replace: true });
});

async function boot() {
  initSync();
  installLinkInterceptor();
  initAdminBadge();

  const [meResult, settingsResult] = await Promise.allSettled([api.get('/api/auth/me'), api.get('/api/settings/public')]);
  if (settingsResult.status === 'fulfilled' && settingsResult.value) store.set({ settings: settingsResult.value });
  const user = meResult.status === 'fulfilled' ? meResult.value?.user ?? null : null;
  store.set({ user });
  if (user) {
    startRealtime();
    refreshAll();
    refreshReportCount();
  }
  resolve();
}

boot();
