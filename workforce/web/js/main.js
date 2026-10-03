// Boot, app shell and route guards.
import { onUnauthorized } from './api.js';
import { LANG, applyLang, has, setLang, t } from './i18n.js';
import { dateShort, money, shiftRange } from './fmt.js';
import { ICON } from './icons.js';
import { currentPath, go, render as rerender, route, start } from './router.js';
import { S, activeBusinesses, bpath, can, clearSession, isOwner, loadMe, loadSettings, pendingVerification, pickBusiness } from './state.js';
import { api } from './api.js';
import { closeSheet, openSheet, toast } from './ui.js';
import { $, SS, html, mount } from './util.js';
import { forgotPage, invitePage, loginPage, registerPage, resetPage, signOut, verifyPage } from './pages/auth.js';
import { homePage } from './pages/home.js';
import { teamPage } from './pages/team.js';
import { permissionsPage } from './pages/permissions.js';
import { auditPage } from './pages/audit.js';
import { accountPage } from './pages/account.js';
import { schedulePage } from './pages/schedule.js';
import { requestsPage } from './pages/requests.js';
import { approvalsPage } from './pages/approvals.js';
import { attendancePage } from './pages/attendance.js';
import { payPage, payrollPage } from './pages/pay.js';
import { expensesPage } from './pages/expenses.js';
import { financePage } from './pages/finance.js';
import { analyticsPage } from './pages/analytics.js';
import { reportsPage } from './pages/reports.js';
import { notificationsPage } from './pages/notifications.js';
import { settingsPage } from './pages/settings.js';
import { memberPage } from './pages/member.js';
import { clockPage, doorPage } from './clock.js';
import { tripsPage } from './pages/trips.js';
import { chatPage, refreshChatBadge } from './pages/chat.js';

route('/login', loginPage);
route('/register', registerPage);
route('/forgot', forgotPage);
route('/reset', resetPage);
route('/verify', verifyPage);
route('/invite', invitePage);
route('/home', homePage);
route('/team', teamPage);
route('/permissions', { ...permissionsPage, perm: 'permissions.manage' });
route('/audit', { ...auditPage, perm: 'audit.view' });
route('/account', accountPage);
route('/schedule', schedulePage);
route('/requests', requestsPage);
route('/approvals', { ...approvalsPage, perm: () => can('shift_requests.approve') || can('swaps.approve') || can('employee_expenses.review') });
route('/attendance', attendancePage);
route('/pay', { ...payPage, perm: 'self.pay' });
route('/payroll', { ...payrollPage, perm: 'payroll.view' });
route('/expenses', { ...expensesPage, perm: 'self.expenses' });
route('/finance', { ...financePage, perm: () => can('business_expenses.view') || can('revenue.view') || can('finance.view') || can('budgets.manage') });
route('/analytics', { ...analyticsPage, perm: () => can('finance.view') || can('analytics.view') });
route('/reports', { ...reportsPage, perm: () => can('reports.operational') || can('reports.financial') });
route('/notifications', notificationsPage);
route('/settings', { ...settingsPage, perm: () => can('business.settings.manage') || can('departments.manage') || can('schedules.manage') });
route('/member', memberPage);
route('/clock', clockPage);
route('/trips', { ...tripsPage, perm: 'attendance.manage' });
route('/chat', chatPage);
route('/door', { ...doorPage, perm: 'attendance.manage' });
route('/more', { title: () => t('more'), render: renderMore });

const root = () => $('#root');

// Navigation follows permissions. `tab` marks the phone bottom-bar items
// (the most-used actions for each role, spec §38-39).
function navItems() {
  const manager = can('schedules.view');
  const finance = can('finance.view');
  const approvals = can('shift_requests.approve') || can('swaps.approve') || can('employee_expenses.review');
  return [
    { path: '/home', icon: ICON.home, label: t('home'), show: true, tab: true },
    { path: '/chat', icon: ICON.chat, label: t('chat'), show: true, tab: true, badge: 'chat' },
    { path: '/analytics', icon: ICON.chart, label: t('analytics'), show: finance || can('analytics.view'), tab: finance },
    { path: '/finance', icon: ICON.money, label: t('finance'), show: can('business_expenses.view') || can('revenue.view') || finance || can('budgets.manage'), tab: finance },
    { path: '/schedule', icon: ICON.calendar, label: manager ? t('schedule') : t('mySchedule'), show: true, tab: !finance },
    { path: '/approvals', icon: ICON.approve, label: t('approvals'), show: approvals, tab: approvals && !finance },
    { path: '/requests', icon: ICON.swap, label: t('myRequests'), show: can('self.requests') || can('self.swaps'), tab: !approvals },
    { path: '/attendance', icon: ICON.clock, label: t('attendance'), show: true },
    { path: '/trips', icon: ICON.scooter, label: t('deliveryTrips'), show: can('attendance.manage') },
    { path: '/pay', icon: ICON.wallet, label: t('myPay'), show: can('self.pay') && !isOwner(), tab: !manager },
    { path: '/expenses', icon: ICON.receipt, label: t('myExpenses'), show: can('self.expenses') && !isOwner() },
    { path: '/payroll', icon: ICON.pay, label: t('payroll'), show: can('payroll.view') },
    { path: '/team', icon: ICON.people, label: t('team'), show: can('members.view') },
    { path: '/reports', icon: ICON.file, label: t('reports'), show: can('reports.operational') || can('reports.financial') },
    { path: '/audit', icon: ICON.log, label: t('audit'), show: can('audit.view') },
    { path: '/permissions', icon: ICON.sliders, label: t('permissions'), show: can('permissions.manage') },
    { path: '/settings', icon: ICON.cog, label: t('settings'), show: can('business.settings.manage') || can('departments.manage') },
    { path: '/notifications', icon: ICON.bell, label: t('notifications'), show: true },
    { path: '/account', icon: ICON.user, label: t('account'), show: true },
  ].filter((i) => i.show).map((i, n, all) => ({ ...i, tab: i.tab && all.filter((x) => x.tab).indexOf(i) < 4 }));
}

let shellKey = null;

function renderShell() {
  const key = `${LANG}|${S.me.user.id}|${S.business.id}|${[...S.perms].join()}`;
  if (shellKey === key && $('#view')) return;
  shellKey = key;
  mount(root(), html`<div class="app">
    <aside class="side" aria-label="${t('appName')}"></aside>
    <div class="main">
      <header class="top"><div class="titles"><span class="biz" id="biz"></span><h1 id="title" tabindex="-1"></h1></div>
        <button class="iconbtn" type="button" id="searchbtn" aria-label="${t('search')}">${ICON.search}</button>
        <a class="iconbtn bell" href="#/notifications" id="bell" aria-label="${t('notifications')}">${ICON.bell}<span class="badge num" hidden></span></a>
        <button class="pillbtn mobile-only" type="button" id="langbtn" aria-label="${t('switchLang')}">${t('lang')}</button></header>
      <main id="view" tabindex="-1"></main>
    </div>
    <nav class="tabs" aria-label="${t('appName')}"></nav>
  </div>`);
  $('#langbtn').onclick = toggleLang;
  $('#searchbtn').onclick = openSearch;
}

// Unread count on the bell, refreshed on navigation and every minute.
let bellTimer;
async function refreshBell() {
  const badge = document.querySelector('#bell .badge');
  if (!badge || !S.business) return;
  try {
    const r = await api.get(bpath('/notifications?limit=1&unread=true'));
    badge.hidden = !r.unread;
    badge.textContent = r.unread > 99 ? '99+' : String(r.unread);
  } catch { /* offline */ }
}
document.addEventListener('notifications:changed', refreshBell);

// Global search (spec §33). Results are limited server-side to what you may see.
function openSearch() {
  const sheet = openSheet({
    title: t('search'),
    body: html`<input class="input" type="search" id="gsq" placeholder="${t('searchEverything')}" aria-label="${t('search')}" autocomplete="off"><div id="gsr" class="search-results"></div>`,
  });
  const input = sheet.querySelector('#gsq');
  const out = sheet.querySelector('#gsr');
  const links = {
    employees: (x) => `/member?id=${x.id}`, departments: () => '/team', shifts: (x) => `/schedule?shift=${x.id}`,
    employeeExpenses: () => '/approvals?tab=expenses', businessExpenses: () => '/finance?tab=expenses', revenue: () => '/finance?tab=revenue',
    payroll: (x) => `/payroll?run=${x.id}`, reports: (x) => `/reports?type=${x.id}`,
  };
  // Shifts, money and payroll results say when and how much.
  const subtitleOf = (x) => [x.subtitle, x.startsAt ? shiftRange(x) : null, x.date ? dateShort(x.date) : null,
    x.amount !== undefined ? money(x.amount) : null, x.status && has(`st_${x.status}`) ? t(`st_${x.status}`) : null].filter(Boolean).join(' · ');
  let seq = 0;
  input.addEventListener('input', async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) return mount(out, '');
    const r = await api.get(bpath(`/search?q=${encodeURIComponent(q)}`)).catch(() => null);
    if (!r || my !== seq) return;
    mount(out, r.groups.length ? html`${r.groups.map((g) => html`<h3 class="h2 small">${t(`sg_${g.key}`)}</h3><div class="listbox">${g.items.map((x) => html`<a class="row" href="#${links[g.key](x)}">
      <span class="mid"><span class="t1">${typeof x.title === 'object' ? x.title[LANG] || x.title.en : x.title}</span>${subtitleOf(x) ? html`<span class="t2">${subtitleOf(x)}</span>` : ''}</span></a>`)}</div>`)}` : html`<p class="muted">${t('noResults')}</p>`);
    out.querySelectorAll('a').forEach((a) => { a.onclick = () => closeSheet(); });
  });
  setTimeout(() => input.focus(), 50);
}

// The unread count beside Chat; filled in by refreshChatBadge().
const badgeOf = (i) => (i.badge === 'chat' ? html`<span class="badge num" data-chat-badge hidden></span>` : '');

function renderNav(path) {
  const items = navItems();
  const b = S.business;
  const multi = activeBusinesses().length > 1;
  const cur = (p) => (p === path ? html`aria-current="page"` : '');
  mount($('.side'), html`
    <div class="brand"><span class="mark">${(b.name.trim()[0] || '·').toUpperCase()}</span>
      <div><b>${b.name}</b><small>${t(`role_${b.role}`)}</small></div></div>
    ${items.map((i) => html`<a class="navbtn" href="#${i.path}" ${cur(i.path)}>${i.icon}<span>${i.label}</span>${badgeOf(i)}</a>`)}
    <div class="foot">
      ${multi ? html`<button class="navbtn" type="button" data-switch>${ICON.globe}<span>${t('switchBusiness')}</span></button>` : ''}
      <button class="navbtn" type="button" data-lang>${ICON.globe}<span>${t('lang')}</span></button>
      <button class="navbtn" type="button" data-signout>${ICON.out}<span>${t('signOut')}</span></button>
    </div>`);
  const tabs = items.filter((i) => i.tab);
  const extra = items.filter((i) => !i.tab);
  const moreActive = path === '/more' || extra.some((i) => i.path === path);
  mount($('.tabs'), html`${tabs.map((i) => html`<a class="tab" href="#${i.path}" ${cur(i.path)}>${i.icon}<span>${i.label}</span>${badgeOf(i)}</a>`)}
    ${extra.length || multi ? html`<a class="tab" href="#/more" ${moreActive ? html`aria-current="page"` : ''}>${ICON.more}<span>${t('more')}</span></a>` : ''}`);
  mount($('#biz'), multi ? html`<button type="button" data-switch>${b.name}${ICON.down}</button>` : html`${b.name}`);
  document.querySelectorAll('[data-switch]').forEach((el) => { el.onclick = switchBusiness; });
  $('.side [data-lang]').onclick = toggleLang;
  $('.side [data-signout]').onclick = signOut;
}

function renderMore(view) {
  const extra = navItems().filter((i) => !i.tab);
  const multi = activeBusinesses().length > 1;
  mount(view, html`<div class="listbox">
    ${extra.map((i) => html`<a class="row" href="#${i.path}"><span class="avatar">${i.icon}</span><span class="mid"><span class="t1">${i.label}</span></span>${badgeOf(i)}<span class="chev">${ICON.chev}</span></a>`)}
    ${multi ? html`<button class="row" type="button" id="more-switch"><span class="avatar">${ICON.globe}</span><span class="mid"><span class="t1">${t('switchBusiness')}</span></span><span class="chev">${ICON.chev}</span></button>` : ''}
    <button class="row" type="button" id="more-out"><span class="avatar">${ICON.out}</span><span class="mid"><span class="t1">${t('signOut')}</span></span></button>
  </div>`);
  if (multi) $('#more-switch', view).onclick = switchBusiness;
  $('#more-out', view).onclick = signOut;
}

function switchBusiness() {
  const sheet = openSheet({
    title: t('yourBusinesses'),
    body: html`<div class="listbox">${activeBusinesses().map((b) => html`<button class="row" type="button" data-b="${b.id}">
      <span class="avatar">${(b.name.trim()[0] || '·').toUpperCase()}</span>
      <span class="mid"><span class="t1">${b.name}</span><span class="t2">${t(`role_${b.role}`)}</span></span>
      ${b.id === S.business.id ? html`<span class="pill ok">${ICON.check}</span>` : ''}</button>`)}</div>`,
  });
  sheet.querySelectorAll('[data-b]').forEach((el) => {
    el.onclick = () => {
      pickBusiness(el.dataset.b);
      closeSheet();
      go('/home', { replace: currentPath() === '/home' });
    };
  });
}

function toggleLang() {
  setLang(LANG === 'ar' ? 'en' : 'ar');
  shellKey = null;
  rerender();
}

function renderNoAccess() {
  shellKey = null;
  mount(root(), html`<div class="center boot"><div class="auth-card"><div class="empty"><b>${t('noAccessTitle')}</b>${t('noAccessBody')}
    <br><button class="btn" type="button" id="na-out">${t('signOut')}</button></div></div></div>`);
  $('#na-out').onclick = signOut;
}

function renderPage(page, ctx) {
  closeSheet();
  if (!page) return go(S.me ? '/home' : '/login', { replace: true });
  if (page.layout === 'auth') {
    if (page.guestOnly && S.me) return go(pendingVerification() ? '/verify' : '/home', { replace: true });
    shellKey = null;
    return page.render(root(), ctx);
  }
  if (!S.me) {
    SS.set('next', `${ctx.path}${ctx.query.toString() ? `?${ctx.query}` : ''}`);
    return go('/login', { replace: true });
  }
  if (pendingVerification()) return go('/verify', { replace: true });
  if (!S.business) return renderNoAccess();
  if (page.perm && !(typeof page.perm === 'function' ? page.perm() : can(page.perm))) return go('/home', { replace: true });
  renderShell();
  renderNav(ctx.path);
  $('#title').textContent = page.title ? page.title() : '';
  document.title = `${page.title ? page.title() + ' · ' : ''}${S.business.name}`;
  // A fresh container per page, so no page's listeners outlive it.
  const old = $('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  loadSettings().catch(() => {}).finally(() => {
    const r = page.render(view, ctx);
    if (r?.catch) r.catch((err) => { console.error(err); toast(t('e.server_error'), { error: true }); });
  });
  refreshBell();
  refreshChatBadge();
  clearInterval(bellTimer);
  bellTimer = setInterval(() => { refreshBell(); refreshChatBadge(); }, 30000);
  if (ctx.prev && ctx.prev !== ctx.path) {
    window.scrollTo(0, 0);
    $('#title').focus({ preventScroll: true });
  }
}

onUnauthorized(() => {
  if (!S.me) return;
  clearSession();
  toast(t('e.unauthorized'));
  SS.set('next', location.hash.replace(/^#/, ''));
  go('/login', { replace: true });
});

async function boot() {
  applyLang();
  try {
    const [, server] = await Promise.all([loadMe(), api.get('/api/config').catch(() => null)]);
    S.server = server;
  } catch {
    mount(root(), html`<div class="boot"><div class="empty"><b>${t('e.network')}</b><button class="btn" type="button" id="boot-retry">${t('retry')}</button></div></div>`);
    $('#boot-retry').onclick = () => location.reload();
    return;
  }
  if (!location.hash || location.hash === '#/' || location.hash === '#') history.replaceState(null, '', S.me ? '#/home' : '#/login');
  start(renderPage);
}

boot();
