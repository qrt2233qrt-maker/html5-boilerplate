// My pay (spec §6) and payroll runs for owners/authorised managers.
import { api } from '../api.js';
import { t, tn } from '../i18n.js';
import { ICON } from '../icons.js';
import { bpath, can } from '../state.js';
import { dateShort, money, num, todayLocal } from '../fmt.js';
import { empty, formSheet, statusPill } from '../components.js';
import { busy, confirmDialog, openSheet, skeletonRows, toast, toastError } from '../ui.js';
import { $, html, mount } from '../util.js';

const period = (p) => `${dateShort(p.periodStart)} – ${dateShort(p.periodEnd)}`;

export const payPage = {
  title: () => t('myPay'),
  async render(view) {
    mount(view, skeletonRows(4));
    const data = await api.get(bpath('/me/pay'));
    if (!view.isConnected) return;
    const c = data.current;
    mount(view, html`${c ? html`<section class="note pay-hero"><div class="lbl">${t('payThisPeriod')} · ${period(c)}</div>
        <div class="big num">${money(c.net)}</div><div class="meta">${statusPill(c.status)}${c.paidAt ? html`<span class="chip">${t('paidOn', { date: dateShort(c.paidAt) })}</span>` : ''}</div>
        ${c.status === 'review' && c.reviewNote ? html`<p class="small">${c.reviewNote}</p>` : ''}</section>
      <section class="panel"><h2>${t('breakdown')}</h2><dl class="kv">
        <dt>${t('hoursWorked')}</dt><dd class="num">${num(c.hours)}</dd>
        <dt>${t('basePay')}</dt><dd class="num">${money(c.base)}</dd>
        <dt>${t('overtime')}${c.overtimeHours ? ` (${num(c.overtimeHours)} ${t('hoursShort')})` : ''}</dt><dd class="num">${money(c.overtime)}</dd>
        <dt>${t('bonuses')}</dt><dd class="num">${money(c.bonuses + c.adjustments)}</dd>
        <dt>${t('deductions')}</dt><dd class="num">− ${money(c.deductions)}</dd>
        <dt>${t('reimbursements')}</dt><dd class="num">+ ${money(c.reimbursements)}</dd>
        <dt><b>${t('netPay')}</b></dt><dd class="num"><b>${money(c.net)}</b></dd></dl></section>` : empty(t('noPayYet'), t('noPayYetBody'))}
      ${data.history.length ? html`<section class="panel"><h2>${t('payHistory')}</h2><div class="tablewrap"><table class="data">
        <thead><tr><th>${t('period')}</th><th>${t('hoursCol')}</th><th>${t('gross')}</th><th>${t('expenses')}</th><th>${t('deductions')}</th><th>${t('net')}</th><th>${t('status')}</th></tr></thead>
        <tbody>${data.history.map((h) => html`<tr><td>${period(h)}</td><td class="num">${num(h.hours)}</td><td class="num">${money(h.gross)}</td><td class="num">${money(h.reimbursements)}</td>
          <td class="num">${money(h.deductions)}</td><td class="num"><b>${money(h.net)}</b></td><td>${statusPill(h.status)}</td></tr>`)}</tbody></table></div>
        <p class="hint">${t('payReadOnly')}</p></section>` : ''}`);
  },
};

export const payrollPage = {
  title: () => t('payroll'),
  async render(view, { query }) {
    if (query.get('run')) return runView(view, query.get('run'));
    mount(view, html`<div class="toolbar"><span class="spacer"></span>
      ${can('payroll.manage') ? html`<button class="btn primary" type="button" id="new">${ICON.plus}${t('startPayroll')}</button>` : ''}</div>
      <div id="runs">${skeletonRows(4)}</div><p class="hint">${t('payrollNote')}</p>`);
    const runs = await api.get(bpath('/payroll/runs'));
    if (!view.isConnected) return;
    mount($('#runs', view), runs.length ? html`<div class="listbox">${runs.map((r) => html`<a class="row" href="#/payroll?run=${r.id}">
      <span class="avatar">${ICON.pay}</span><span class="mid"><span class="t1">${period(r)}</span><span class="t2">${tn('peopleN', r.people)}</span></span>
      <span class="end"><b class="num">${money(r.net)}</b>${statusPill(r.status)}</span><span class="chev">${ICON.chev}</span></a>`)}</div>`
      : empty(t('noPayrollRuns'), t('noPayrollRunsBody')));
    $('#new', view)?.addEventListener('click', () => formSheet({
      title: t('startPayroll'), intro: t('startPayrollBody'), submitLabel: t('calculate'),
      fields: [{ name: 'date', label: t('dayInPeriod'), type: 'date', value: todayLocal(), required: true }],
      onSubmit: async (v) => { const r = await api.post(bpath('/payroll/runs'), { date: v.date }); location.hash = `#/payroll?run=${r.id}`; },
    }));
  },
};

async function runView(view, id) {
  mount(view, skeletonRows(6));
  const r = await api.get(bpath(`/payroll/runs/${id}`));
  if (!view.isConnected) return;
  const edit = can('payroll.manage');
  const draft = r.status === 'draft';
  mount(view, html`<p><a href="#/payroll">← ${t('allPayrolls')}</a></p>
    <div class="toolbar"><h2 class="h2 grow">${period(r)} ${statusPill(r.status)}</h2>
      ${edit && draft ? html`<button class="btn small" type="button" data-a="recalc">${t('recalculate')}</button><button class="btn small primary" type="button" data-a="finalize">${t('finalize')}</button>` : ''}
      ${edit && r.status === 'finalized' ? html`<button class="btn small" type="button" data-a="reopen">${t('reopen')}</button><button class="btn small primary" type="button" data-a="pay">${t('markAllPaid')}</button>` : ''}</div>
    <div class="kpis small">${[['gross', r.totals.gross], ['reimbursements', r.totals.reimbursements], ['deductions', r.totals.deductions], ['net', r.totals.net]].map(([k, v]) => html`<div class="kpi"><small>${t(k)}</small><b class="num">${money(v || 0)}</b></div>`)}</div>
    ${r.status === 'paid' ? html`<div class="banner ok"><span>${ICON.lock} ${t('runLocked')}</span></div>` : ''}
    ${r.people.length ? html`<div class="tablewrap"><table class="data"><thead><tr><th>${t('person')}</th><th>${t('hoursCol')}</th><th>${t('basePay')}</th><th>${t('overtime')}</th><th>${t('bonuses')}</th><th>${t('deductions')}</th><th>${t('expenses')}</th><th>${t('net')}</th><th>${t('status')}</th><th></th></tr></thead>
      <tbody>${r.people.map((p) => html`<tr><td>${p.name}</td><td class="num">${num(p.hours)}</td><td class="num">${money(p.base)}</td><td class="num">${money(p.overtime)}</td>
        <td class="num">${money(p.bonuses + p.adjustments)}</td><td class="num">${money(p.deductions)}</td><td class="num">${money(p.reimbursements)}</td><td class="num"><b>${money(p.net)}</b></td><td>${statusPill(p.status)}</td>
        <td class="row-gap">${edit && draft ? html`<button class="btn small ghost" type="button" data-item="${p.membershipId}">${t('addLine')}</button>` : ''}
          ${edit && r.status !== 'paid' && p.status !== 'paid' ? html`<button class="btn small ghost" type="button" data-review="${p.membershipId}" data-on="${p.status === 'review' ? 0 : 1}">${p.status === 'review' ? t('clearReview') : t('flagReview')}</button>` : ''}
          ${edit && r.status === 'finalized' && p.status === 'pending' ? html`<button class="btn small ghost" type="button" data-paid="${p.membershipId}">${t('markPaid')}</button>` : ''}
          <button class="btn small ghost" type="button" data-lines="${p.membershipId}">${t('details')}</button></td></tr>`)}</tbody></table></div>` : empty(t('noPeopleInRun'), t('noPeopleInRunBody'))}`);
  const reload = () => runView(view, id);
  view.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      const a = b.dataset.a;
      if (a === 'finalize' && !(await confirmDialog({ title: t('finalizeQ'), body: t('finalizeBody'), confirm: t('finalize') }))) return;
      if (a === 'pay' && !(await confirmDialog({ title: t('markAllPaidQ'), body: t('markAllPaidBody'), confirm: t('markAllPaid') }))) return;
      if (a) {
        busy(b);
        await api.post(bpath(`/payroll/runs/${id}/${{ recalc: 'recalculate', finalize: 'finalize', reopen: 'reopen', pay: 'pay' }[a]}`), {});
        toast(t('saved'));
        return reload();
      }
      if (b.dataset.item) {
        return formSheet({
          title: t('addLine'),
          fields: [
            { name: 'kind', label: t('type'), type: 'seg', value: 'bonus', options: [['bonus', t('bonus')], ['deduction', t('deduction')], ['adjustment', t('adjustment')]] },
            { name: 'amount', label: t('amount'), type: 'signedMoney', required: true, hint: t('adjustmentHint') },
            { name: 'description', label: t('description'), type: 'text', required: true },
          ],
          onSubmit: async (v) => { await api.post(bpath(`/payroll/runs/${id}/items`), { membershipId: b.dataset.item, ...v }); reload(); },
        });
      }
      if (b.dataset.review) {
        if (b.dataset.on === '1') {
          return formSheet({
            title: t('flagReview'), submitLabel: t('flagReview'),
            fields: [{ name: 'note', label: t('noteForEmployee'), type: 'textarea', required: true, full: true }],
            onSubmit: async (v) => { await api.post(bpath(`/payroll/runs/${id}/review`), { membershipId: b.dataset.review, review: true, note: v.note }); reload(); },
          });
        }
        busy(b);
        await api.post(bpath(`/payroll/runs/${id}/review`), { membershipId: b.dataset.review, review: false });
        return reload();
      }
      if (b.dataset.paid) {
        busy(b);
        await api.post(bpath(`/payroll/runs/${id}/pay`), { membershipIds: [b.dataset.paid] });
        return reload();
      }
      if (b.dataset.lines) {
        const items = r.items.filter((i) => i.membershipId === b.dataset.lines);
        const sheet = openSheet({
          title: r.people.find((p) => p.membershipId === b.dataset.lines).name,
          body: html`<div class="listbox">${items.map((i) => html`<div class="row"><span class="mid"><span class="t1">${t(`item_${i.kind}`)}</span>
            <span class="t2">${i.description || ''}${i.minutes ? ` · ${num(i.minutes / 60)} ${t('hoursShort')}` : ''}</span></span>
            <span class="end num">${i.kind === 'deduction' ? '− ' : ''}${money(i.amount)}</span>
            ${edit && draft && !i.generated ? html`<button class="btn small ghost" type="button" data-rm="${i.id}">${t('remove')}</button>` : ''}</div>`)}</div>`,
        });
        sheet.querySelectorAll('[data-rm]').forEach((x) => { x.onclick = async () => { await api.del(bpath(`/payroll/runs/${id}/items/${x.dataset.rm}`)); sheet.close(); reload(); }; });
      }
    } catch (err) {
      busy(b, false);
      toastError(err);
    }
  };
}
