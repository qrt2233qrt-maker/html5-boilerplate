// My pay (spec §6) and payroll runs for owners/authorised managers.
import { api } from '../api.js';
import { t, tn } from '../i18n.js';
import { ICON } from '../icons.js';
import { S, bpath, can, isOwner } from '../state.js';
import { addDays, dateShort, dayLabel, money, num, todayLocal } from '../fmt.js';
import { empty, formSheet, statusPill } from '../components.js';
import { busy, confirmDialog, openSheet, skeletonRows, toast, toastError } from '../ui.js';
import { $, html, mount } from '../util.js';

const period = (p) => (p.periodStart === p.periodEnd ? dateShort(p.periodStart) : `${dateShort(p.periodStart)} – ${dateShort(p.periodEnd)}`);

// A detailed payslip: every line, each day paid with hours and trips, and
// the year so far. Printable.
export async function payslipSheet(runId, membershipId) {
  const p = await api.get(bpath(`/payroll/runs/${runId}/payslips/${membershipId}`));
  const s = p.summary;
  const minus = (k) => ['deduction', 'advance'].includes(k);
  const sheet = openSheet({
    title: t('payslip'),
    body: html`<article class="payslip">
      <header class="ps-head"><div><b>${p.business}</b><small>${t('payslip')} · ${period(p.run)}</small></div>${statusPill(s.status)}</header>
      <div class="ps-person"><b>${p.person.name}</b><small>${[p.person.jobTitle, p.person.department, p.person.number ? `#${p.person.number}` : null].filter(Boolean).join(' · ')}</small></div>
      <div class="ps-net"><small>${t('netPay')}</small><b class="num">${money(s.net)}</b></div>
      <table class="data ps-lines"><tbody>${p.lines.map((l) => html`<tr class="${minus(l.kind) ? 'minus' : ''}"><td>${t(`item_${l.kind}`)}<small>${l.description && l.description !== t(`item_${l.kind}`) ? l.description : ''}${l.minutes ? ` · ${num(l.minutes / 60)} ${t('hoursShort')}` : ''}${l.quantity ? ` · ${tn('tripsN', l.quantity)}` : ''}</small></td>
        <td class="num">${minus(l.kind) ? '− ' : ''}${money(l.amount)}</td></tr>`)}
        <tr class="total"><td>${t('gross')}</td><td class="num">${money(s.gross)}</td></tr>
        <tr class="total"><td><b>${t('netPay')}</b></td><td class="num"><b>${money(s.net)}</b></td></tr></tbody></table>
      ${p.days.length ? html`<details class="ps-days"><summary>${t('daysPaid', { n: p.days.length })}</summary>
        <table class="data"><thead><tr><th>${t('date')}</th><th>${t('hoursCol')}</th><th>${t('tripsCol')}</th></tr></thead>
        <tbody>${p.days.map((d) => html`<tr class="${d.minutes || d.trips ? '' : 'muted'}"><td>${dayLabel(d.day)}</td><td class="num">${d.minutes ? num(d.minutes / 60) : '—'}</td><td class="num">${d.trips || '—'}</td></tr>`)}</tbody></table></details>` : ''}
      <dl class="kv ps-ytd"><dt>${t('yearToDate', { year: p.yearToDate.year })}</dt><dd class="num">${money(p.yearToDate.net)}</dd>
        ${p.advanceLeft ? html`<dt>${t('advanceLeft')}</dt><dd class="num">${money(p.advanceLeft)}</dd>` : ''}</dl>
    </article>`,
    foot: html`<button class="btn" type="button" id="ps-print">${ICON.print}${t('printPdf')}</button>`,
  });
  $('#ps-print', sheet).onclick = () => { document.body.classList.add('print-sheet'); window.print(); setTimeout(() => document.body.classList.remove('print-sheet'), 500); };
}

export const payPage = {
  title: () => t('myPay'),
  async render(view) {
    mount(view, skeletonRows(4));
    const [data, trips] = await Promise.all([
      api.get(bpath('/me/pay')),
      api.get(bpath(`/trips?mine=true&from=${addDays(todayLocal(), -13)}&to=${todayLocal()}`)).catch(() => null),
    ]);
    if (!view.isConnected) return;
    const c = data.current;
    // Drivers see the trips entered for them, so they can check their pay.
    const myTrips = trips?.drivers.length ? html`<section class="panel"><h2>${t('myTrips')}</h2>
      ${trips.entries.length ? html`<div class="listbox">${[...trips.entries].reverse().map((e) => html`<div class="row"><span class="mid"><span class="t1">${dayLabel(e.day)}</span>
        ${e.note ? html`<span class="t2">${e.note}</span>` : ''}</span><span class="end"><b class="num">${tn('tripsN', e.trips)}</b>
        <span class="t2 num">${money(e.trips * (trips.drivers[0].pay?.rate || 0))}</span></span></div>`)}</div>` : empty(t('noTripsYet'))}
      <p class="hint">${t('myTripsHint')}</p></section>` : '';
    mount(view, html`${c ? html`<section class="note pay-hero"><div class="lbl">${t('payThisPeriod')} · ${period(c)}</div>
        <div class="big num">${money(c.net)}</div><div class="meta">${statusPill(c.status)}${c.paidAt ? html`<span class="chip">${t('paidOn', { date: dateShort(c.paidAt) })}</span>` : ''}</div>
        ${c.status === 'review' && c.reviewNote ? html`<p class="small">${c.reviewNote}</p>` : ''}</section>
      <section class="panel"><h2>${t('breakdown')}</h2><dl class="kv">
        <dt>${t('hoursWorked')}</dt><dd class="num">${num(c.hours)}</dd>
        <dt>${t('basePay')}</dt><dd class="num">${money(c.base)}</dd>
        <dt>${t('overtime')}${c.overtimeHours ? ` (${num(c.overtimeHours)} ${t('hoursShort')})` : ''}</dt><dd class="num">${money(c.overtime)}</dd>
        ${c.tripCount ? html`<dt>${t('deliveryTrips')} (${num(c.tripCount, 0)})</dt><dd class="num">${money(c.trips)}</dd>` : ''}
        ${c.allowances ? html`<dt>${t('allowances')}</dt><dd class="num">${money(c.allowances)}</dd>` : ''}
        <dt>${t('bonuses')}</dt><dd class="num">${money(c.bonuses + c.adjustments)}</dd>
        <dt>${t('deductions')}</dt><dd class="num">− ${money(c.deductions)}</dd>
        ${c.advances ? html`<dt>${t('advanceRepayment')}</dt><dd class="num">− ${money(c.advances)}</dd>` : ''}
        <dt>${t('reimbursements')}</dt><dd class="num">+ ${money(c.reimbursements)}</dd>
        <dt><b>${t('netPay')}</b></dt><dd class="num"><b>${money(c.net)}</b></dd></dl>
        <button class="btn block" type="button" data-slip="${c.id}">${ICON.file}${t('openPayslip')}</button></section>` : empty(t('noPayYet'), t('noPayYetBody'))}
      ${data.history.length ? html`<section class="panel"><h2>${t('payHistory')}</h2><div class="tablewrap"><table class="data">
        <thead><tr><th>${t('period')}</th><th>${t('hoursCol')}</th><th>${t('gross')}</th><th>${t('expenses')}</th><th>${t('deductions')}</th><th>${t('net')}</th><th>${t('status')}</th></tr></thead>
        <tbody>${data.history.map((h) => html`<tr class="clickable" data-slip="${h.id}" tabindex="0"><td>${period(h)}</td><td class="num">${num(h.hours)}</td><td class="num">${money(h.gross)}</td><td class="num">${money(h.reimbursements)}</td>
          <td class="num">${money(h.deductions)}</td><td class="num"><b>${money(h.net)}</b></td><td>${statusPill(h.status)}</td></tr>`)}</tbody></table></div>
        <p class="hint">${t('payReadOnly')}</p></section>` : ''}${myTrips}`);
    view.onclick = (e) => { const r = e.target.closest('[data-slip]'); if (r) payslipSheet(r.dataset.slip, S.business.membershipId).catch(toastError); };
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
      <span class="avatar">${ICON.pay}</span><span class="mid"><span class="t1">${period(r)}</span><span class="t2">${t(`freq_${r.frequency}`)} · ${tn('peopleN', r.people)}</span></span>
      <span class="end"><b class="num">${money(r.net)}</b>${statusPill(r.status)}</span><span class="chev">${ICON.chev}</span></a>`)}</div>`
      : empty(t('noPayrollRuns'), t('noPayrollRunsBody')));
    const adv = (await api.get(bpath('/payroll/advances')).catch(() => [])).filter((a) => !a.cancelledAt && a.left > 0);
    if (adv.length && view.isConnected) {
      $('#runs', view).insertAdjacentHTML('afterend', String(html`<section class="panel"><h2>${t('advancesOutstanding')}</h2><div class="listbox">${adv.map((a) => html`<a class="row" href="#/member?id=${a.membershipId}&tab=pay">
        <span class="mid"><span class="t1">${a.name}</span><span class="t2">${t('advanceLine', { given: dateShort(a.givenOn), each: money(a.instalment) })}${a.note ? ` · ${a.note}` : ''}</span></span>
        <span class="end"><b class="num">${money(a.left)}</b><span class="t2 num">${t('ofAmount', { amount: money(a.amount) })}</span></span></a>`)}</div></section>`));
    }
    $('#new', view)?.addEventListener('click', () => formSheet({
      title: t('startPayroll'), intro: t('startPayrollBody'), submitLabel: t('calculate'),
      fields: [
        { name: 'frequency', label: t('whoToPay'), type: 'seg', full: true, value: S.settings?.payroll?.frequency || 'monthly', options: ['daily', 'weekly', 'biweekly', 'monthly'].map((f) => [f, t(`payGroup_${f}`)]) },
        { name: 'date', label: t('dayInPeriod'), type: 'date', value: todayLocal(), required: true },
      ],
      onSubmit: async (v) => { const r = await api.post(bpath('/payroll/runs'), { date: v.date, frequency: v.frequency }); location.hash = `#/payroll?run=${r.id}`; },
    }));
  },
};

async function runView(view, id) {
  mount(view, skeletonRows(6));
  const r = await api.get(bpath(`/payroll/runs/${id}`));
  if (!view.isConnected) return;
  const edit = can('payroll.manage');
  const draft = r.status === 'draft';
  const trips = r.people.some((p) => p.tripCount);
  const anyPaid = r.people.some((p) => p.status === 'paid');
  const allow = r.people.some((p) => p.allowances);
  const advs = r.people.some((p) => p.advances);
  mount(view, html`<p><a href="#/payroll">← ${t('allPayrolls')}</a></p>
    <div class="toolbar"><h2 class="h2 grow">${period(r)} <span class="pill">${t(`freq_${r.frequency}`)}</span> ${statusPill(r.status)}</h2>
      ${edit && draft ? html`<button class="btn small" type="button" data-a="recalc">${t('recalculate')}</button><button class="btn small primary" type="button" data-a="finalize">${t('finalize')}</button>` : ''}
      ${edit && r.status === 'finalized' && !anyPaid ? html`<button class="btn small" type="button" data-a="reopen">${t('reopen')}</button>` : ''}
      ${edit && r.status === 'finalized' ? html`<button class="btn small primary" type="button" data-a="pay">${t('markAllPaid')}</button>` : ''}
      ${isOwner() && (r.status === 'paid' || anyPaid) ? html`<button class="btn small" type="button" data-a="correct">${t('reopenToCorrect')}</button>` : ''}</div>
    <div class="kpis small">${[['gross', r.totals.gross], ['allowances', r.totals.allowances], ['reimbursements', r.totals.reimbursements], ['deductions', (r.totals.deductions || 0) + (r.totals.advances || 0)], ['net', r.totals.net]]
    .filter(([k, v]) => k !== 'allowances' || v).map(([k, v]) => html`<div class="kpi"><small>${t(k)}</small><b class="num">${money(v || 0)}</b></div>`)}
      ${r.previous ? html`<div class="kpi"><small>${t('vsPreviousPayroll')}</small><b class="num">${r.previous.change === null ? '—' : `${r.previous.change > 0 ? '↑' : r.previous.change < 0 ? '↓' : '='} ${Math.abs(Math.round(r.previous.change * 100))}%`}</b><span class="muted small">${money(r.previous.gross)}</span></div>` : ''}</div>
    ${r.status === 'paid' ? html`<div class="banner ok"><span>${ICON.lock} ${isOwner() ? t('runLockedOwner') : t('runLocked')}</span></div>` : ''}
    ${r.corrections.some((c) => !c.closedAt) ? html`<div class="banner"><span>${t('beingCorrected', { reason: r.corrections.at(-1).reason })}</span></div>` : ''}
    ${r.people.length ? html`<div class="tablewrap"><table class="data"><thead><tr><th>${t('person')}</th><th>${t('hoursCol')}</th><th>${t('basePay')}</th><th>${t('overtime')}</th>${trips ? html`<th>${t('tripsCol')}</th>` : ''}${allow ? html`<th>${t('allowances')}</th>` : ''}<th>${t('bonuses')}</th><th>${t('deductions')}</th>${advs ? html`<th>${t('advanceShort')}</th>` : ''}<th>${t('expenses')}</th><th>${t('net')}</th><th>${t('status')}</th><th></th></tr></thead>
      <tbody>${r.people.map((p) => html`<tr><td>${p.name}</td><td class="num">${num(p.hours)}</td><td class="num">${money(p.base)}</td><td class="num">${money(p.overtime)}</td>
        ${trips ? html`<td class="num">${p.tripCount ? html`${money(p.trips)} <small class="muted">(${p.tripCount})</small>` : '—'}</td>` : ''}${allow ? html`<td class="num">${money(p.allowances)}</td>` : ''}<td class="num">${money(p.bonuses + p.adjustments)}</td><td class="num">${money(p.deductions)}</td>${advs ? html`<td class="num">${money(p.advances)}</td>` : ''}<td class="num">${money(p.reimbursements)}</td><td class="num"><b>${money(p.net)}</b></td><td>${statusPill(p.status)}</td>
        <td class="row-gap">${edit && draft ? html`<button class="btn small ghost" type="button" data-item="${p.membershipId}">${t('addLine')}</button>` : ''}
          ${edit && r.status !== 'paid' && p.status !== 'paid' ? html`<button class="btn small ghost" type="button" data-review="${p.membershipId}" data-on="${p.status === 'review' ? 0 : 1}">${p.status === 'review' ? t('clearReview') : t('flagReview')}</button>` : ''}
          ${edit && r.status === 'finalized' && p.status === 'pending' ? html`<button class="btn small ghost" type="button" data-paid="${p.membershipId}">${t('markPaid')}</button>` : ''}
          <button class="btn small ghost" type="button" data-slip="${p.membershipId}">${t('payslip')}</button>
          ${edit && draft ? html`<button class="btn small ghost" type="button" data-lines="${p.membershipId}">${t('lines')}</button>` : ''}</td></tr>`)}</tbody></table></div>` : empty(t('noPeopleInRun'), t('noPeopleInRunBody'))}
    <div class="cols">
      ${r.sections.length > 1 || r.sections[0]?.name ? html`<section class="panel"><h2>${t('payrollBySection')}</h2><div class="sections">${r.sections.map((x) => html`<div class="sec">
        <div class="sec-head"><b>${x.name ?? t('notAssigned')}</b><span class="num">${money(x.gross)}</span></div>
        <div class="sec-bar"><span class="seg s1" data-w="${r.totals.gross ? (x.gross / r.totals.gross) * 100 : 0}"></span></div>
        <p class="t2 muted">${tn('peopleN', x.people)}</p></div>`)}</div></section>` : ''}
      ${r.corrections.length ? html`<section class="panel"><h2>${t('correctionHistory')}</h2><div class="listbox">${r.corrections.map((c) => html`<div class="row"><span class="mid">
        <span class="t1">${c.reason}</span><span class="t2">${t('correctionLine', { who: c.reopenedBy || '—', date: dateShort(c.reopenedAt) })}</span></span>
        <span class="end num">${money(c.netBefore)} → ${c.netAfter === null ? '…' : money(c.netAfter)}</span></div>`)}</div></section>` : ''}
    </div>`);
  view.querySelectorAll('.sec-bar .seg').forEach((x) => x.style.setProperty('--w', `${x.dataset.w}%`));
  const reload = () => runView(view, id);
  view.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      const a = b.dataset.a;
      if (a === 'finalize' && !(await confirmDialog({ title: t('finalizeQ'), body: t('finalizeBody'), confirm: t('finalize') }))) return;
      if (a === 'pay' && !(await confirmDialog({ title: t('markAllPaidQ'), body: t('markAllPaidBody'), confirm: t('markAllPaid') }))) return;
      if (a === 'correct') {
        return formSheet({
          title: t('reopenToCorrect'), intro: t('reopenToCorrectBody'), submitLabel: t('reopenToCorrect'),
          fields: [{ name: 'reason', label: t('whatNeedsCorrecting'), type: 'textarea', required: true, full: true }],
          onSubmit: async (v) => { await api.post(bpath(`/payroll/runs/${id}/reopen`), { reason: v.reason }); toast(t('reopenedForCorrection')); reload(); },
        });
      }
      if (b.dataset.slip) return payslipSheet(id, b.dataset.slip);
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
            <span class="end num">${['deduction', 'advance'].includes(i.kind) ? '− ' : ''}${money(i.amount)}</span>
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
