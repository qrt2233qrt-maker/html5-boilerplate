// Boot, app shell and route guards.
import { onUnauthorized } from './api.js';
import { LANG, applyLang, setLang, t } from './i18n.js';
import { ICON } from './icons.js';
import { currentPath, go, render as rerender, route, start } from './router.js';
import { S, activeBusinesses, can, clearSession, loadMe, pendingVerification, pickBusiness } from './state.js';
import { closeSheet, openSheet, toast } from './ui.js';
import { $, SS, html, mount } from './util.js';
import { forgotPage, invitePage, loginPage, registerPage, resetPage, signOut, verifyPage } from './pages/auth.js';
import { homePage } from './pages/home.js';
import { teamPage } from './pages/team.js';
import { permissionsPage } from './pages/permissions.js';
import { auditPage } from './pages/audit.js';
import { accountPage } from './pages/account.js';

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
route('/more', { title: () => t('more'), render: renderMore });

const root = () => $('#root');

function navItems() {
  return [
    { path: '/home', icon: ICON.home, label: t('home'), show: true, tab: true },
    { path: '/team', icon: ICON.people, label: t('team'), show: can('members.view'), tab: true },
    { path: '/permissions', icon: ICON.sliders, label: t('permissions'), show: can('permissions.manage') },
    { path: '/audit', icon: ICON.log, label: t('audit'), show: can('audit.view') },
    { path: '/account', icon: ICON.user, label: t('account'), show: true, tab: true },
  ].filter((i) => i.show);
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
        <button class="pillbtn mobile-only" type="button" id="langbtn" aria-label="${t('switchLang')}">${t('lang')}</button></header>
      <main id="view" tabindex="-1"></main>
    </div>
    <nav class="tabs" aria-label="${t('appName')}"></nav>
  </div>`);
  $('#langbtn').onclick = toggleLang;
}

function renderNav(path) {
  const items = navItems();
  const b = S.business;
  const multi = activeBusinesses().length > 1;
  const cur = (p) => (p === path ? html`aria-current="page"` : '');
  mount($('.side'), html`
    <div class="brand"><span class="mark">${(b.name.trim()[0] || '·').toUpperCase()}</span>
      <div><b>${b.name}</b><small>${t(`role_${b.role}`)}</small></div></div>
    ${items.map((i) => html`<a class="navbtn" href="#${i.path}" ${cur(i.path)}>${i.icon}<span>${i.label}</span></a>`)}
    <div class="foot">
      ${multi ? html`<button class="navbtn" type="button" data-switch>${ICON.globe}<span>${t('switchBusiness')}</span></button>` : ''}
      <button class="navbtn" type="button" data-lang>${ICON.globe}<span>${t('lang')}</span></button>
      <button class="navbtn" type="button" data-signout>${ICON.out}<span>${t('signOut')}</span></button>
    </div>`);
  const tabs = items.filter((i) => i.tab);
  const extra = items.filter((i) => !i.tab);
  const moreActive = path === '/more' || extra.some((i) => i.path === path);
  mount($('.tabs'), html`${tabs.map((i) => html`<a class="tab" href="#${i.path}" ${cur(i.path)}>${i.icon}<span>${i.label}</span></a>`)}
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
    ${extra.map((i) => html`<a class="row" href="#${i.path}"><span class="avatar">${i.icon}</span><span class="mid"><span class="t1">${i.label}</span></span><span class="chev">${ICON.chev}</span></a>`)}
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
  if (page.perm && !can(page.perm)) return go('/home', { replace: true });
  renderShell();
  renderNav(ctx.path);
  $('#title').textContent = page.title ? page.title() : '';
  document.title = `${page.title ? page.title() + ' · ' : ''}${S.business.name}`;
  const view = $('#view');
  view.innerHTML = '';
  page.render(view, ctx);
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
    await loadMe();
  } catch {
    mount(root(), html`<div class="boot"><div class="empty"><b>${t('e.network')}</b><button class="btn" type="button" id="boot-retry">${t('retry')}</button></div></div>`);
    $('#boot-retry').onclick = () => location.reload();
    return;
  }
  if (!location.hash || location.hash === '#/' || location.hash === '#') history.replaceState(null, '', S.me ? '#/home' : '#/login');
  start(renderPage);
}

boot();
