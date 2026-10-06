// My requests and swaps (spec §4-5): status of everything I asked for,
// swaps waiting for my answer, and shifts colleagues are giving away.
import { api } from '../api.js';
import { discussRequest } from './chat.js';
import { t } from '../i18n.js';
import { ICON } from '../icons.js';
import { S, bpath, can } from '../state.js';
import { dayLabel, shiftRange, time, todayLocal, addDays } from '../fmt.js';
import { empty, statusPill } from '../components.js';
import { busy, confirmDialog, skeletonRows, toast } from '../ui.js';
import { $, html, mount } from '../util.js';
import { changeSheet, showError, swapSheet, timeOffSheet } from './schedule.js';

export const requestsPage = {
  title: () => t('myRequests'),
  async render(view, { query }) {
    mount(view, html`<div class="toolbar">
        ${can('self.requests') ? html`<button class="btn small" type="button" data-new="change">${ICON.clock}${t('requestChange')}</button>
          <button class="btn small" type="button" data-new="time_off">${ICON.calendar}${t('requestTimeOff')}</button>` : ''}
        ${can('self.swaps') ? html`<button class="btn small" type="button" data-new="swap">${ICON.swap}${t('swapShift')}</button>` : ''}
      </div><div id="body">${skeletonRows(5)}</div>`);
    view.querySelectorAll('[data-new]').forEach((b) => { b.onclick = () => startNew(b.dataset.new); });
    await draw(view);
    const n = query.get('new');
    if (n) startNew(n);
  },
};

document.addEventListener('requests:changed', () => {
  const view = $('#view');
  if (location.hash.startsWith('#/requests') && view && $('#body', view)) draw(view);
});

async function startNew(kind) {
  if (kind === 'time_off') return timeOffSheet();
  // Pick one of my upcoming shifts first.
  const today = todayLocal();
  const shifts = (await api.get(bpath(`/shifts?from=${today}&to=${addDays(today, 60)}&mine=true`))).filter((s) => s.status === 'scheduled' && new Date(s.startsAt) > Date.now());
  if (!shifts.length) return toast(t('noUpcomingShifts'));
  const { formSheet } = await import('../components.js');
  formSheet({
    title: kind === 'swap' ? t('swapShift') : t('requestChange'), submitLabel: t('continue'),
    fields: [{ name: 'shift', label: t('chooseShift'), type: 'seg', full: true, options: shifts.map((s) => [s.id, shiftRange(s)]) }],
    onSubmit: async (v, btn, form) => {
      const s = shifts.find((x) => x.id === v.shift);
      if (!s) { form.querySelector('#err-shift').textContent = t('e.required'); return false; }
      setTimeout(() => (kind === 'swap' ? swapSheet(s) : changeSheet(s)), 450);
    },
  });
}

async function draw(view) {
  const body = $('#body', view);
  const [reqs, swaps] = await Promise.all([api.get(bpath('/shift-requests?mine=true')), api.get(bpath('/swaps?mine=true'))]);
  if (!body.isConnected) return;
  const me = S.business.membershipId;
  const mine = reqs.filter((r) => r.membershipId === me);
  const available = reqs.filter((r) => r.type === 'offer' && r.membershipId !== me && r.status === 'pending' && !r.takerMembershipId);
  const incoming = swaps.filter((w) => w.target.membershipId === me && w.status === 'pending_peer');
  const swapList = swaps.filter((w) => !incoming.includes(w));
  const reqRow = (r) => html`<div class="row"><span class="avatar">${r.type === 'time_off' ? ICON.calendar : r.type === 'offer' ? ICON.send : ICON.clock}</span>
    <span class="mid"><span class="t1">${t(`req_${r.type}`)}</span>
      <span class="t2 num">${r.type === 'time_off' ? `${dayLabel(r.requestedStartsAt)} – ${dayLabel(new Date(new Date(r.requestedEndsAt) - 1).toISOString())}` : r.shiftStartsAt ? shiftRange({ startsAt: r.shiftStartsAt, endsAt: r.shiftEndsAt }) : ''}
      ${r.type === 'change' && r.requestedStartsAt ? ` → ${time(r.requestedStartsAt)}–${time(r.requestedEndsAt)}` : ''}${r.takerName ? ` → ${r.takerName}` : ''}</span>
      ${r.reviewNote ? html`<span class="t2">“${r.reviewNote}”</span>` : ''}</span>
    <span class="end">${statusPill(r.status)}<button class="btn small ghost" type="button" data-discuss="${r.id}">${ICON.chat}${t('discuss')}</button>${r.status === 'pending' ? html`<button class="btn small ghost" type="button" data-cancel-req="${r.id}">${t('cancel')}</button>` : ''}</span></div>`;
  const swapRow = (w) => {
    const iAsked = w.requester.membershipId === me;
    const other = iAsked ? w.target : w.requester;
    const myShift = iAsked ? w.requester : w.target;
    return html`<div class="row"><span class="avatar">${ICON.swap}</span>
      <span class="mid"><span class="t1">${t('swapWithName', { name: other.name })}</span>
        <span class="t2 num">${t('youGive')}: ${shiftRange(myShift)}</span><span class="t2 num">${t('youGet')}: ${shiftRange(other)}</span></span>
      <span class="end">${statusPill(w.status)}${iAsked && ['pending_peer', 'pending_approval'].includes(w.status) ? html`<button class="btn small ghost" type="button" data-cancel-swap="${w.id}">${t('cancel')}</button>` : ''}</span></div>`;
  };
  mount(body, html`
    ${incoming.length ? html`<section class="panel attention"><h2>${t('swapsForYou')}</h2><div class="listbox wrap">${incoming.map((w) => html`<div class="row">
      <span class="avatar">${ICON.swap}</span><span class="mid"><span class="t1">${t('swapAsk', { name: w.requester.name })}</span>
        <span class="t2 num">${t('youGive')}: ${shiftRange(w.target)}</span><span class="t2 num">${t('youGet')}: ${shiftRange(w.requester)}</span>${w.reason ? html`<span class="t2">“${w.reason}”</span>` : ''}</span>
      <span class="end row-gap"><button class="btn small primary" type="button" data-respond="${w.id}" data-accept="1">${t('accept')}</button>
        <button class="btn small" type="button" data-respond="${w.id}" data-accept="0">${t('decline')}</button></span></div>`)}</div></section>` : ''}
    ${available.length ? html`<section class="panel"><h2>${t('shiftsUpForGrabs')}</h2><div class="listbox wrap">${available.map((r) => html`<div class="row">
      <span class="avatar">${ICON.send}</span><span class="mid"><span class="t1">${r.memberName}</span><span class="t2 num">${shiftRange({ startsAt: r.shiftStartsAt, endsAt: r.shiftEndsAt })}</span></span>
      <span class="end"><button class="btn small primary" type="button" data-take="${r.id}">${t('takeShift')}</button></span></div>`)}</div></section>` : ''}
    <section class="panel"><h2>${t('myRequests')}</h2>${mine.length ? html`<div class="listbox wrap">${mine.map(reqRow)}</div>` : empty(t('noRequests'), t('noRequestsBody'))}</section>
    <section class="panel"><h2>${t('swaps')}</h2>${swapList.length ? html`<div class="listbox wrap">${swapList.map(swapRow)}</div>` : empty(t('noSwaps'))}</section>`);
  body.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.discuss) return discussRequest(b.dataset.discuss, b);
    try {
      if (b.dataset.cancelReq) {
        if (!(await confirmDialog({ title: t('cancelRequestQ'), confirm: t('cancelRequest'), danger: true }))) return;
        busy(b); await api.post(bpath(`/shift-requests/${b.dataset.cancelReq}/cancel`)); toast(t('requestCancelled'));
      } else if (b.dataset.cancelSwap) {
        if (!(await confirmDialog({ title: t('cancelSwapQ'), confirm: t('cancelSwap'), danger: true }))) return;
        busy(b); await api.post(bpath(`/swaps/${b.dataset.cancelSwap}/cancel`)); toast(t('swapCancelled'));
      } else if (b.dataset.respond) {
        busy(b); await api.post(bpath(`/swaps/${b.dataset.respond}/respond`), { accept: b.dataset.accept === '1' });
        toast(b.dataset.accept === '1' ? t('swapAcceptedToast') : t('swapDeclinedToast'));
      } else if (b.dataset.take) {
        busy(b); await api.post(bpath(`/shift-requests/${b.dataset.take}/take`)); toast(t('takenToast'));
      } else return;
      draw(view);
    } catch (err) {
      busy(b, false);
      showError(err);
    }
  };
}

