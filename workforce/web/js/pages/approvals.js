// Approvals inbox for managers and owners (spec §34, §39).
import { api } from '../api.js';
import { t } from '../i18n.js';
import { ICON } from '../icons.js';
import { bpath, can } from '../state.js';
import { dateShort, dayLabel, money, shiftRange, time } from '../fmt.js';
import { docUrl, empty, formSheet, statusPill, waitingOnMe } from '../components.js';
import { busy, skeletonRows, toast } from '../ui.js';
import { $, html, mount } from '../util.js';
import { showError } from './schedule.js';

export const approvalsPage = {
  title: () => t('approvals'),
  async render(view, { query }) {
    const tabs = [
      can('shift_requests.approve') && ['requests', t('shiftRequests')],
      can('swaps.approve') && ['swaps', t('swaps')],
      can('employee_expenses.review') && ['expenses', t('employeeExpenses')],
    ].filter(Boolean);
    const tab = tabs.find(([k]) => k === query.get('tab'))?.[0] || tabs[0]?.[0];
    mount(view, html`<div class="tabbar" role="tablist">${tabs.map(([k, l]) => html`<a role="tab" class="tabbtn" href="#/approvals?tab=${k}" aria-selected="${k === tab}">${l}<span class="count num" data-count="${k}"></span></a>`)}</div>
      <div id="body">${skeletonRows(4)}</div>`);
    if (!tab) return mount($('#body', view), empty(t('nothingToApprove')));
    // Counts for every tab, list for the current one.
    const [reqs, swaps, claims] = await Promise.all([
      can('shift_requests.approve') ? api.get(bpath('/shift-requests?status=pending')) : [],
      can('swaps.approve') ? api.get(bpath('/swaps?status=pending_approval')) : [],
      can('employee_expenses.review') ? api.get(bpath('/employee-expenses')).then((l) => l.filter(waitingOnMe)) : [],
    ]);
    if (!view.isConnected) return;
    const ready = reqs.filter((r) => r.type !== 'offer' || r.takerMembershipId);
    const counts = { requests: ready.length, swaps: swaps.length, expenses: claims.length };
    view.querySelectorAll('[data-count]').forEach((n) => { n.textContent = counts[n.dataset.count] ? ` ${counts[n.dataset.count]}` : ''; });
    const body = $('#body', view);
    const actions = (kind, id) => html`<span class="end row-gap"><button class="btn small primary" type="button" data-approve="${kind}:${id}">${t('approve')}</button>
      <button class="btn small danger" type="button" data-reject="${kind}:${id}">${t('reject')}</button></span>`;
    if (tab === 'requests') {
      mount(body, ready.length ? html`<div class="listbox wrap">${ready.map((r) => html`<div class="row">
        <span class="avatar">${r.type === 'time_off' ? ICON.calendar : r.type === 'offer' ? ICON.send : ICON.clock}</span>
        <span class="mid"><span class="t1">${r.memberName} · ${t(`req_${r.type}`)}</span>
          <span class="t2 num">${r.type === 'time_off' ? `${dayLabel(r.requestedStartsAt)} – ${dayLabel(new Date(new Date(r.requestedEndsAt) - 1).toISOString())}` : shiftRange({ startsAt: r.shiftStartsAt, endsAt: r.shiftEndsAt })}
          ${r.type === 'change' ? ` → ${dayLabel(r.requestedStartsAt)} ${time(r.requestedStartsAt)}–${time(r.requestedEndsAt)}` : ''}${r.takerName ? ` → ${r.takerName}` : ''}</span>
          ${r.reason ? html`<span class="t2">“${r.reason}”</span>` : ''}</span>${actions('request', r.id)}</div>`)}</div>` : empty(t('allCaughtUp')));
    } else if (tab === 'swaps') {
      mount(body, swaps.length ? html`<div class="listbox wrap">${swaps.map((w) => html`<div class="row"><span class="avatar">${ICON.swap}</span>
        <span class="mid"><span class="t1">${w.requester.name} ⇄ ${w.target.name}</span>
          <span class="t2 num">${w.requester.name}: ${shiftRange(w.requester)}</span><span class="t2 num">${w.target.name}: ${shiftRange(w.target)}</span>
          ${w.reason ? html`<span class="t2">“${w.reason}”</span>` : ''}</span>${actions('swap', w.id)}</div>`)}</div>` : empty(t('allCaughtUp')));
    } else {
      mount(body, claims.length ? html`<div class="listbox wrap">${claims.map((c) => html`<div class="row"><span class="avatar">${c.icon || '🧾'}</span>
        <span class="mid"><span class="t1">${c.memberName} · <span class="num">${money(c.amount)}</span></span>
          <span class="t2">${c.description} · ${dateShort(c.spentOn)}${c.businessPurpose ? ` · ${c.businessPurpose}` : ''}</span>
          <span class="t2">${statusPill(c.status)}${c.needsOwner ? html` <span class="pill">${t('needsOwner')}</span>` : ''}
            ${c.receiptDocumentId ? html` <a href="${docUrl(c.receiptDocumentId)}" target="_blank" rel="noopener">${t('viewReceipt')}</a>` : html` <span class="muted">${t('noReceipt')}</span>`}</span></span>
        <span class="end row-gap">${can('employee_expenses.approve') ? html`<button class="btn small primary" type="button" data-approve="expense:${c.id}">${t('approve')}</button>
          <button class="btn small danger" type="button" data-reject="expense:${c.id}">${t('reject')}</button>` : ''}
          ${c.status === 'submitted' ? html`<button class="btn small" type="button" data-review="${c.id}">${t('markUnderReview')}</button>` : ''}</span></div>`)}</div>` : empty(t('allCaughtUp')));
    }
    body.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const decide = async (kind, id, approve, note) => {
        if (kind === 'request') await api.post(bpath(`/shift-requests/${id}/review`), { approve, note: note || null });
        if (kind === 'swap') await api.post(bpath(`/swaps/${id}/review`), { approve, note: note || null });
        if (kind === 'expense') {
          const r = await api.post(bpath(`/employee-expenses/${id}/decide`), { action: approve ? 'approve' : 'reject', note: note || null });
          if (approve && r.status !== 'approved') toast(t('sentToOwner'));
        }
      };
      try {
        if (b.dataset.approve) {
          const [kind, id] = b.dataset.approve.split(':');
          busy(b);
          await decide(kind, id, true);
          toast(t('approvedToast'));
          approvalsPage.render(view, { query: new URLSearchParams(`tab=${tab}`) });
        } else if (b.dataset.reject) {
          const [kind, id] = b.dataset.reject.split(':');
          formSheet({
            title: t('reject'), danger: true, submitLabel: t('reject'),
            fields: [{ name: 'note', label: t('reasonForEmployee'), type: 'textarea', required: true, full: true }],
            onSubmit: async (v) => { await decide(kind, id, false, v.note); toast(t('rejectedToast')); approvalsPage.render(view, { query: new URLSearchParams(`tab=${tab}`) }); },
          });
        } else if (b.dataset.review) {
          busy(b);
          await api.post(bpath(`/employee-expenses/${b.dataset.review}/decide`), { action: 'review' });
          approvalsPage.render(view, { query: new URLSearchParams(`tab=${tab}`) });
        }
      } catch (err) {
        busy(b, false);
        showError(err);
      }
    };
  },
};
