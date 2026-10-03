// Team: members, invitations, invite form and per-member actions.
import { api, qs } from '../api.js';
import { fmtDate, fmtInt, fmtMoney, relTime, t } from '../i18n.js';
import { payUnit } from '../fmt.js';
import { ICON } from '../icons.js';
import { S, bpath, can, isOwner } from '../state.js';
import {
  busy, closeSheet, confirmDialog, field, fieldError, onSubmit, openSheet, removeAnimated,
  skeletonRows, success, syncList, toast, toastError,
} from '../ui.js';
import { $, $$, debounce, html, initials, mount, parseMoney } from '../util.js';

const st = { tab: 'members', q: '', role: '', status: '', members: new Map(), order: [], cursor: null, total: 0, invites: [] };

export const teamPage = {
  title: () => t('team'),
  perm: 'members.view',
  render(view, { query }) {
    st.tab = query.get('tab') === 'invitations' && can('members.invite') ? 'invitations' : 'members';
    mount(view, html`
      <div class="toolbar">
        ${can('members.invite') ? html`<div class="tabbar" role="tablist">
          <button type="button" role="tab" data-tab="members" aria-selected="${st.tab === 'members'}">${t('members')}<span class="count muted num" id="c-members"></span></button>
          <button type="button" role="tab" data-tab="invitations" aria-selected="${st.tab === 'invitations'}">${t('invitations')}<span class="count muted num" id="c-invites"></span></button>
        </div>` : ''}
        <span class="spacer"></span>
        ${can('members.invite') ? html`<button class="btn primary" type="button" id="invite-btn">${ICON.plus}${t('invite')}</button>` : ''}
      </div>
      <section id="tab-members" ${st.tab === 'members' ? '' : 'hidden'}>
        <div class="toolbar">
          <input class="input" type="search" id="q" placeholder="${t('searchTeam')}" aria-label="${t('searchTeam')}" value="${st.q}">
          <select class="input" id="f-role" aria-label="${t('role')}">
            <option value="">${t('allRoles')}</option>
            ${['owner', 'manager', 'employee'].map((r) => html`<option value="${r}" ${st.role === r ? 'selected' : ''}>${t(`role_${r}`)}</option>`)}
          </select>
          <select class="input" id="f-status" aria-label="${t('anyStatus')}">
            <option value="">${t('anyStatus')}</option>
            ${['active', 'suspended', 'terminated'].map((s) => html`<option value="${s}" ${st.status === s ? 'selected' : ''}>${t(`status_${s}`)}</option>`)}
          </select>
        </div>
        <div id="m-box">${skeletonRows(5)}</div>
        <div class="empty hidden" id="m-empty"></div>
        <p class="row-gap"><button class="btn block hidden" type="button" id="m-more">${t('loadMore')}</button></p>
      </section>
      <section id="tab-invitations" ${st.tab === 'invitations' ? '' : 'hidden'}>
        <div class="listbox list" id="i-list"></div>
        <div class="empty hidden" id="i-empty">${t('noInvites')}</div>
      </section>`);

    $$('[data-tab]', view).forEach((b) => { b.onclick = () => switchTab(view, b.dataset.tab); });
    $('#invite-btn', view)?.addEventListener('click', () => openInvite(view));
    $('#q', view).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); loadMembers(view); }, 250));
    $('#f-role', view).onchange = (e) => { st.role = e.target.value; loadMembers(view); };
    $('#f-status', view).onchange = (e) => { st.status = e.target.value; loadMembers(view); };
    $('#m-more', view).onclick = () => loadMembers(view, true);
    view.addEventListener('click', (ev) => {
      const m = ev.target.closest('[data-m]');
      if (m) openMember(view, m.dataset.m);
      const act = ev.target.closest('[data-inv]');
      if (act) inviteAction(view, act.dataset.inv, act.dataset.id, act);
    });

    loadMembers(view);
    if (can('members.invite')) loadInvites(view);
    if (query.get('invite') === '1' && can('members.invite')) openInvite(view);
  },
};

function switchTab(view, tab) {
  st.tab = tab;
  $$('[data-tab]', view).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#tab-members', view).hidden = tab !== 'members';
  $('#tab-invitations', view).hidden = tab !== 'invitations';
  history.replaceState(null, '', `#/team${tab === 'invitations' ? '?tab=invitations' : ''}`);
}

// ---------- members ----------

const isMe = (m) => m.userId === S.me.user.id;
const rolePill = (role) => html`<span class="pill ${role === 'owner' ? 'owner' : role === 'manager' ? 'info' : ''}">${t(`role_${role}`)}</span>`;
const statusPill = (s) => (s === 'active' ? '' : html`<span class="pill ${s === 'suspended' ? 'warn' : 'over'}">${t(`status_${s}`)}</span>`);

function memberRow(m) {

  return html`<button class="row" type="button" data-m="${m.membershipId}">
    <span class="avatar" aria-hidden="true">${initials(m.name)}</span>
    <span class="mid"><span class="t1">${m.name}${isMe(m) ? html` <span class="muted">(${t('you')})</span>` : ''}</span>
      ${m.profile.jobTitle ? html`<span class="t2">${m.profile.jobTitle}</span>` : ''}
      <span class="t2 ltrline">${m.email || m.phone}</span></span>
    <span class="end">${rolePill(m.role)}${statusPill(m.status)}</span>
    <span class="chev">${ICON.chev}</span></button>`;
}

function drawMembers(view) {
  let list = $('#m-list', view);
  if (!list) {
    mount($('#m-box', view), html`<div class="listbox list" id="m-list"></div>`);
    list = $('#m-list', view);
  }
  syncList(list, st.order.map((id) => ({ key: id, tpl: memberRow(st.members.get(id)) })));
  list.parentElement.classList.toggle('hidden', st.order.length === 0);
  const empty = $('#m-empty', view);
  const filtered = st.q || st.role || st.status;
  empty.classList.toggle('hidden', st.order.length > 0 && !(st.total <= 1 && !filtered && can('members.invite')));
  if (st.order.length === 0) mount(empty, html`${t('noMatch')}`);
  else if (st.total <= 1 && !filtered && can('members.invite')) {
    mount(empty, html`<b>${t('noMembersTitle')}</b>${t('noMembersBody')}<br><button class="btn primary" type="button" id="empty-invite">${ICON.plus}${t('inviteSomeone')}</button>`);
    $('#empty-invite', empty).onclick = () => openInvite(view);
  }
  $('#m-more', view).classList.toggle('hidden', !st.cursor);
  const c = $('#c-members', view);
  if (c) c.textContent = fmtInt(st.total);
}

let membersReq = 0;
async function loadMembers(view, more = false) {
  const req = ++membersReq;
  const btn = $('#m-more', view);
  if (more) busy(btn);
  try {
    const res = await api.get(bpath(`/members${qs({ q: st.q, role: st.role, status: st.status, limit: 30, cursor: more ? st.cursor : '' })}`));
    if (req !== membersReq || !view.isConnected) return;
    if (!more) { st.members.clear(); st.order = []; }
    for (const m of res.items) {
      st.members.set(m.membershipId, m);
      st.order.push(m.membershipId);
    }
    st.cursor = res.nextCursor;
    st.total = res.total;
    drawMembers(view);
  } catch (err) {
    if (req === membersReq) toastError(err);
  } finally {
    busy(btn, false);
  }
}

function canActOn(m) {
  return m.role !== 'owner' && !isMe(m) && (isOwner() || m.role === 'employee');
}

function openMember(view, id) {
  const m = st.members.get(id);
  if (!m) return;
  const p = m.profile || {};
  const b = S.business;
  const pay = m.pay ? `${fmtMoney(m.pay.rate, b.currency, b.currencyExponent)} ${payUnit(m.pay.payType)}` : null;
  const rows = [
    [t('jobTitle'), p.jobTitle], [t('employeeNumber'), p.employeeNumber], [t('department'), m.departmentName],
    [t('startDate'), p.startDate && fmtDate(p.startDate)], [t('payRate'), pay], [t('joined', { when: '' }).trim(), fmtDate(m.joinedAt)],
  ].filter(([, v]) => v);
  const actionable = canActOn(m);
  const actions = [];
  if (actionable && can('roles.assign') && m.status === 'active') {
    actions.push(m.role === 'manager'
      ? html`<button class="btn" type="button" data-a="demote">${ICON.people}${t('removeManager')}</button>`
      : html`<button class="btn" type="button" data-a="promote">${ICON.shield}${t('makeManager')}</button>`);
  }
  if (actionable && can('permissions.manage') && m.status === 'active') {
    actions.push(html`<button class="btn" type="button" data-a="perms">${ICON.sliders}${t('memberPermissions', { name: m.name.split(' ')[0] })}</button>`);
  }
  if (actionable && can('members.suspend')) {
    if (m.status === 'active') actions.push(html`<button class="btn danger" type="button" data-a="suspend">${ICON.lock}${t('suspend')}</button>`);
    if (m.status === 'suspended') actions.push(html`<button class="btn" type="button" data-a="reactivate">${ICON.key}${t('reactivate')}</button>`);
  }
  const sheet = openSheet({
    title: m.name,
    body: html`<div class="profile-head"><span class="avatar lg" aria-hidden="true">${initials(m.name)}</span>
        <div><h3>${m.name}</h3><div class="row-gap">${rolePill(m.role)}${statusPill(m.status)}</div></div></div>
      ${m.email || m.phone ? html`<div class="row-gap">
        ${m.phone ? html`<a class="btn small" href="tel:${m.phone}">${ICON.phone}<span class="ltr">${m.phone}</span></a>` : ''}
        ${m.email ? html`<a class="btn small" href="mailto:${m.email}">${ICON.mail}<span class="ltr">${m.email}</span></a>` : ''}</div>` : ''}
      ${rows.length ? html`<dl class="kv panel">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : ''}
      <a class="btn block" href="#/member?id=${m.membershipId}">${ICON.user}${t('openProfile')}</a>
      ${actions.length ? html`<div class="action-list">${actions}</div>` : ''}`,
  });
  $$('[data-a]', sheet).forEach((btn) => { btn.onclick = () => memberAction(view, m, btn.dataset.a, btn); });
}

async function memberAction(view, m, action, btn) {
  const first = m.name;
  const flows = {
    promote: { title: t('confirmMakeManagerTitle', { name: first }), body: t('confirmMakeManagerBody'), confirm: t('makeManager'),
      call: () => api.post(bpath(`/members/${m.membershipId}/role`), { role: 'manager' }), done: t('madeManager', { name: first }) },
    demote: { title: t('confirmRemoveManagerTitle', { name: first }), body: t('confirmRemoveManagerBody', { name: first }), confirm: t('removeManager'),
      call: () => api.post(bpath(`/members/${m.membershipId}/role`), { role: 'employee' }), done: t('removedManager', { name: first }) },
    suspend: { title: t('confirmSuspendTitle', { name: first }), body: t('confirmSuspendBody'), confirm: t('suspend'), danger: true,
      call: () => api.post(bpath(`/members/${m.membershipId}/suspend`)), done: t('suspendedToast', { name: first }) },
    reactivate: { call: () => api.post(bpath(`/members/${m.membershipId}/reactivate`)), done: t('reactivatedToast', { name: first }) },
  };
  if (action === 'perms') return openMemberPermissions(m);
  const f = flows[action];
  if (f.title && !(await confirmDialog({ title: f.title, body: f.body, confirm: f.confirm, danger: f.danger }))) return;
  busy(btn);
  try {
    const updated = await f.call();
    st.members.set(m.membershipId, { ...m, ...updated, membershipId: m.membershipId });
    drawMembers(view);
    closeSheet();
    toast(f.done);
  } catch (err) {
    busy(btn, false);
    toastError(err);
  }
}

// Per-person overrides on top of the role's settings.
async function openMemberPermissions(m) {
  const sheet = openSheet({ title: t('memberPermissions', { name: m.name }), body: skeletonRows(6) });
  let matrix;
  let mine;
  try {
    [matrix, mine] = await Promise.all([api.get(bpath('/permissions')), api.get(bpath(`/members/${m.membershipId}/permissions`))]);
  } catch (err) {
    closeSheet();
    return toastError(err);
  }
  const permRow = (p) => {
    const overridden = p.key in mine.overrides;
    const on = overridden ? mine.overrides[p.key] : p.roles[mine.role].allowed;
    return html`<div class="perm"><div class="mid"><b>${t(`p.${p.key}`)}</b>
      ${overridden ? html`<small><span class="pill info">${t('customBadge')}</span><button class="linkbtn" type="button" data-reset="${p.key}">${t('useDefault')}</button></small>` : ''}</div>
      <label class="switch"><input type="checkbox" role="switch" data-p="${p.key}" ${on ? 'checked' : ''} aria-label="${t(`p.${p.key}`)}"><span></span></label></div>`;
  };
  const draw = () => {
    const groups = new Map();
    for (const p of matrix.filter((x) => !x.ownerOnly)) {
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group).push(p);
    }
    mount($('.sbody', sheet), html`${[...groups].map(([g, perms]) => html`<div class="perm-group"><h3>${t(`group_${g}`)}</h3><div class="listbox">
      ${perms.map(permRow)}</div></div>`)}`);
  };
  const save = async (key, value, input) => {
    try {
      mine = await api.put(bpath(`/members/${m.membershipId}/permissions`), { [key]: value });
      draw();
    } catch (err) {
      if (input) input.checked = !input.checked;
      toastError(err);
    }
  };
  sheet.onchange = (ev) => { const i = ev.target.closest('[data-p]'); if (i) save(i.dataset.p, i.checked, i); };
  sheet.onclick = (ev) => { const r = ev.target.closest('[data-reset]'); if (r) save(r.dataset.reset, null); };
  draw();
}

// ---------- invitations ----------

function inviteRow(inv) {
  const pill = { pending: 'warn', expired: 'over' }[inv.status] || '';
  const when = inv.status === 'expired' ? t('inv_expired') : t('sentAgo', { when: relTime(inv.lastSentAt) });
  return html`<div class="row">
    <span class="avatar" aria-hidden="true">${initials(inv.name)}</span>
    <span class="mid"><span class="t1">${inv.name}</span><span class="t2 ltrline">${inv.email || inv.phone}</span>
      <span class="t2">${t(`role_${inv.role}`)} · ${when}</span></span>
    <span class="end"><span class="pill ${pill}">${t(`inv_${inv.status}`)}</span>
      <span class="row-gap"><button class="btn small ghost" type="button" data-inv="resend" data-id="${inv.id}">${t('resendInvite')}</button>
      <button class="btn small ghost" type="button" data-inv="revoke" data-id="${inv.id}" aria-label="${t('revokeInvite')}: ${inv.name}">${ICON.x}</button></span></span>
  </div>`;
}

function drawInvites(view) {
  const open = st.invites.filter((i) => i.status === 'pending' || i.status === 'expired');
  syncList($('#i-list', view), open.map((i) => ({ key: i.id, tpl: inviteRow(i) })));
  $('#i-list', view).classList.toggle('hidden', open.length === 0);
  $('#i-empty', view).classList.toggle('hidden', open.length > 0);
  const c = $('#c-invites', view);
  if (c) c.textContent = open.length ? fmtInt(open.length) : '';
}

async function loadInvites(view) {
  try {
    st.invites = await api.get(bpath('/invitations'));
    if (view.isConnected) drawInvites(view);
  } catch (err) {
    toastError(err);
  }
}

async function inviteAction(view, action, id, btn) {
  const inv = st.invites.find((i) => i.id === id);
  if (!inv) return;
  if (action === 'revoke') {
    const ok = await confirmDialog({ title: t('confirmRevokeTitle'), body: t('confirmRevokeBody', { name: inv.name }), confirm: t('revokeInvite'), danger: true });
    if (!ok) return;
  }
  busy(btn);
  try {
    await api.post(bpath(`/invitations/${id}/${action}`));
    if (action === 'revoke') {
      await removeAnimated(btn.closest('.li'));
      st.invites = st.invites.filter((i) => i.id !== id);
      toast(t('inviteRevokedToast'));
    } else {
      toast(t('inviteResent'));
    }
    await loadInvites(view);
  } catch (err) {
    toastError(err);
  } finally {
    busy(btn, false);
  }
}

function openInvite(view) {
  const b = S.business;
  const showPay = can('payroll.manage');
  const sheet = openSheet({
    title: t('inviteSheet'),
    body: html`<form id="invite-form" novalidate>
      <div class="form-error" role="alert"></div>
      ${field({ name: 'name', label: t('fullName'), autocomplete: 'off', required: true })}
      <div class="grid-2">
        ${field({ name: 'email', label: t('email'), type: 'email', autocomplete: 'off', optional: true, attrs: html`dir="ltr" autocapitalize="none" spellcheck="false"` })}
        ${field({ name: 'phone', label: t('phone'), type: 'tel', inputmode: 'tel', autocomplete: 'off', optional: true, attrs: html`dir="ltr"` })}
      </div>
      <p class="hint">${t('inviteContactHint')}</p>
      <div class="field"><span class="label" id="role-lbl">${t('role')}</span>
        <div class="seg" role="radiogroup" aria-labelledby="role-lbl">
          <label><input type="radio" name="role" value="employee" checked><span>${t('role_employee')}</span></label>
          ${can('roles.assign') ? html`<label><input type="radio" name="role" value="manager"><span>${t('role_manager')}</span></label>` : ''}
        </div></div>
      <button class="linkbtn" type="button" id="details-toggle" aria-expanded="false" aria-controls="details">${t('employmentDetails')} (${t('optional')})</button>
      <div class="collapse" id="details"><div class="inner"><div class="grid-2">
        ${field({ name: 'employeeNumber', label: t('employeeNumber'), autocomplete: 'off' })}
        ${field({ name: 'jobTitle', label: t('jobTitle'), autocomplete: 'off' })}
        <div id="dept-slot">${field({ name: 'department', label: t('department'), autocomplete: 'off' })}</div>
        ${field({ name: 'startDate', label: t('startDate'), type: 'date' })}
      </div>
      ${showPay ? html`<div class="field"><span class="label" id="pay-lbl">${t('payType')}</span>
        <div class="seg" role="radiogroup" aria-labelledby="pay-lbl">
          <label><input type="radio" name="payType" value="hourly"><span>${t('pay_hourly')}</span></label>
          <label><input type="radio" name="payType" value="salaried"><span>${t('pay_salaried')}</span></label>
          <label><input type="radio" name="payType" value="per_trip"><span>${t('pay_per_trip')}</span></label>
        </div></div>
        ${field({ name: 'payRate', label: `${t('payRate')} (${b.currency})`, inputmode: 'decimal', autocomplete: 'off', attrs: html`dir="ltr"` })}
        <div class="field"><label class="label" for="f-payFrequency">${t('payFrequency')}</label>
          <select class="input" id="f-payFrequency" name="payFrequency"><option value="">${t('freqBusinessDefault')}</option>
            ${['daily', 'weekly', 'biweekly', 'monthly'].map((f) => html`<option value="${f}">${t(`freq_${f}`)}</option>`)}</select></div>` : ''}
      </div></div>
    </form>`,
    foot: html`<button class="btn primary" type="submit" form="invite-form">${ICON.send}${t('sendInvite')}</button>`,
  });
  const form = $('#invite-form', sheet);
  // With departments set up, pick one; otherwise typing a name creates it.
  api.get(bpath('/departments')).then((list) => {
    const live = list.filter((x) => !x.archivedAt);
    if (!live.length || !sheet.isConnected) return;
    mount($('#dept-slot', sheet), html`<div class="field"><label class="label" for="f-departmentId">${t('department')}</label>
      <select class="input" id="f-departmentId" name="departmentId">${live.length > 1 || isOwner() ? html`<option value="">—</option>` : ''}
        ${live.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select><span class="err" id="err-departmentId"></span></div>`);
  }).catch(() => {});
  const toggle = $('#details-toggle', sheet);
  toggle.onclick = () => {
    const open = $('#details', sheet).classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  };
  const submitBtn = $('.sfoot button', sheet);
  onSubmit(form, async (d) => {
    if (!d.email && !d.phone) return fieldError(form, 'email', t('e.contact_required'));
    const profile = {};
    for (const k of ['employeeNumber', 'jobTitle', 'department', 'departmentId', 'startDate']) if (d[k]) profile[k] = d[k];
    if (showPay && d.payRate) {
      const rate = parseMoney(d.payRate, b.currencyExponent);
      if (rate === null) return fieldError(form, 'payRate', t('e.invalid_input'));
      profile.payRate = rate;
      profile.payType = d.payType || 'salaried';
      if (d.payFrequency) profile.payFrequency = d.payFrequency;
    }
    await api.post(bpath('/invitations'), { name: d.name, email: d.email, phone: d.phone, role: d.role, profile });
    await success(submitBtn, t('done'));
    closeSheet();
    toast(t('inviteSent', { name: d.name }));
    loadInvites(view);
  });
  $('#f-name', sheet).focus();
}
