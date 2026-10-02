// Home: who you are here, what to do next. Later phases add each role's
// dashboard (shifts, pay, finance) to this page.
import { api } from '../api.js';
import { t, tn } from '../i18n.js';
import { ICON, guilloche } from '../icons.js';
import { S, bpath, can, isOwner } from '../state.js';
import { LS, html, mount } from '../util.js';

let drawn = false;

function greeting(name) {
  const h = new Date().getHours();
  const first = String(name).split(/\s+/)[0];
  return t(h < 12 ? 'goodMorning' : h < 18 ? 'goodAfternoon' : 'goodEvening', { name: first });
}

const tile = (href, icon, label) => html`<a class="tile" href="#${href}"><span class="ic">${icon}</span><span>${label}</span></a>`;

export const homePage = {
  title: () => t('home'),
  render(view) {
    const b = S.business;
    const u = S.me.user;
    const draw = !drawn;
    drawn = true;
    mount(view, html`
      <section class="note ${draw ? 'draw' : ''}" aria-labelledby="hero-name">${guilloche()}
        <div class="lbl">${greeting(u.name)}</div>
        <div class="big" id="hero-name">${b.name}</div>
        <div class="meta"><span class="chip">${t(`role_${b.role}`)}</span><span class="chip num" id="hero-count" hidden></span></div>
      </section>
      <div id="home-body"><div class="skeleton sk-panel"></div></div>`);
    load(view);
  },
};

async function load(view) {
  const body = view.querySelector('#home-body');
  const [members, invites] = await Promise.all([
    can('members.view') ? api.get(bpath('/members?limit=1')).catch(() => null) : null,
    can('members.invite') ? api.get(bpath('/invitations')).catch(() => null) : null,
  ]);
  if (!body.isConnected) return;
  const count = view.querySelector('#hero-count');
  if (members) {
    count.textContent = tn('memberCount', members.total);
    count.hidden = false;
  }
  const u = S.me.user;
  const pending = (invites || []).filter((i) => i.status === 'pending').length;

  const actions = [
    can('members.invite') && tile('/team?invite=1', ICON.plus, t('inviteSomeone')),
    can('members.view') && tile('/team', ICON.people, t('team')),
    can('permissions.manage') && tile('/permissions', ICON.sliders, t('permissions')),
    can('audit.view') && tile('/audit', ICON.log, t('audit')),
    tile('/account', ICON.user, t('account')),
  ].filter(Boolean);

  let checklist = '';
  if (isOwner()) {
    const steps = [
      { done: (!u.email || u.emailVerified) && (!u.phone || u.phoneVerified), label: t('stepVerify'), href: '/account' },
      { done: u.twoFactorEnabled, label: t('step2fa'), href: '/account?focus=2fa' },
      { done: (members?.total || 0) > 1 || pending > 0, label: t('stepInvite'), href: '/team?invite=1' },
      { done: !!LS.get(`perms-reviewed:${S.business.id}`), label: t('stepPerms'), href: '/permissions' },
    ];
    if (!steps.every((s) => s.done)) {
      checklist = html`<section class="panel"><h2>${t('setupTitle')}</h2><ul class="checklist">
        ${steps.map((s) => html`<li class="${s.done ? 'done' : ''}"><span class="tick">${s.done ? ICON.check : ''}</span>
          <span class="txt">${s.label}</span>${s.done ? '' : html`<a class="btn small" href="#${s.href}">${t('continue')}</a>`}</li>`)}
      </ul></section>`;
    }
  }

  const secure = !isOwner() && !u.twoFactorEnabled
    ? html`<div class="banner info"><span><b>${t('secureTitle')}.</b> ${t('secureBody')}</span><a class="btn small" href="#/account?focus=2fa">${t('turnOn')}</a></div>`
    : '';

  const employee = !can('members.view')
    ? html`<section class="panel"><h2>${t('allSet')}</h2><p class="muted">${t('employeeBody', { business: S.business.name })}</p></section>`
    : '';

  mount(body, html`${secure}${checklist}${employee}
    ${pending ? html`<a class="banner ok" href="#/team?tab=invitations"><span>${tn('pendingInvites', pending)}</span><span class="chev">${ICON.chev}</span></a>` : ''}
    <h2 class="h2">${t('quickActions')}</h2><div class="tiles">${actions}</div>`);
}
