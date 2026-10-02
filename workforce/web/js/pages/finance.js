// Business money: expenses, recurring expenses, revenue and budgets
// (spec §8-10, §26). Records are archived, never deleted, and every change
// keeps its history.
import { api, qs } from '../api.js';
import { LANG, t, tn } from '../i18n.js';
import { ICON } from '../icons.js';
import { bpath, can } from '../state.js';
import { dateShort, money, pct, todayLocal } from '../fmt.js';
import { dateRangeBar, docUrl, empty, formSheet, rangeState } from '../components.js';
import { confirmDialog, openSheet, skeletonRows, toast, toastError } from '../ui.js';
import { $, debounce, html, mount } from '../util.js';

const nm = (c) => (LANG === 'ar' ? c.nameAr ?? c.categoryAr : c.nameEn ?? c.categoryEn);
const METHODS = ['cash', 'card', 'bank', 'wallet', 'cheque'];
const methodOptions = () => METHODS.map((m) => [m, t(`method_${m}`)]);

export const financePage = {
  title: () => t('finance'),
  async render(view, { query }) {
    const tabs = [
      can('business_expenses.view') && ['expenses', t('expenses')],
      can('business_expenses.view') && ['recurring', t('recurring')],
      can('revenue.view') && ['revenue', t('revenue')],
      (can('finance.view') || can('budgets.manage')) && ['budgets', t('budgets')],
    ].filter(Boolean);
    const tab = tabs.find(([k]) => k === query.get('tab'))?.[0] || tabs[0]?.[0];
    mount(view, html`<div class="tabbar" role="tablist">${tabs.map(([k, l]) => html`<a role="tab" class="tabbtn" href="#/finance?tab=${k}" aria-selected="${k === tab}">${l}</a>`)}</div><div id="tab"></div>`);
    const host = $('#tab', view);
    const [ecats, rcats, depts] = await Promise.all([api.get(bpath('/categories/expense')), api.get(bpath('/categories/revenue')), api.get(bpath('/departments'))]);
    const ctx = { view, host, query, ecats: ecats.filter((c) => !c.archivedAt), rcats: rcats.filter((c) => !c.archivedAt), depts: depts.filter((d) => !d.archivedAt) };
    if (tab === 'expenses') return ledger(ctx, 'expense');
    if (tab === 'revenue') return ledger(ctx, 'revenue');
    if (tab === 'recurring') return recurring(ctx);
    if (tab === 'budgets') return budgets(ctx);
  },
};

// ---------- expenses and revenue lists ----------

async function ledger(ctx, kind) {
  const { host, query } = ctx;
  const isExp = kind === 'expense';
  const manage = can(isExp ? 'business_expenses.manage' : 'revenue.manage');
  const range = rangeState(`fin-${kind}`);
  const f = { q: '', categoryId: '' };
  const cats = isExp ? ctx.ecats : ctx.rcats;
  mount(host, html`<div class="toolbar"><div id="range"></div>
      <input class="input" type="search" id="q" placeholder="${t('search')}" aria-label="${t('search')}">
      <select class="input" id="cat" aria-label="${t('category')}"><option value="">${t('allCategories')}</option>${cats.map((c) => html`<option value="${c.id}">${c.icon || ''} ${nm(c)}</option>`)}</select>
      <span class="spacer"></span>${manage ? html`<button class="btn primary" type="button" id="add">${ICON.plus}${isExp ? t('addBusinessExpense') : t('addRevenue')}</button>` : ''}</div>
    <div id="total"></div><div id="rows">${skeletonRows(6)}</div>`);
  const load = async () => {
    const path = isExp ? '/business-expenses' : '/revenue';
    const res = await api.get(bpath(`${path}${qs({ from: range.from, to: range.to, q: f.q, categoryId: f.categoryId, limit: 300 })}`));
    if (!host.isConnected) return;
    mount($('#total', host), html`<p class="muted">${tn('countTotal', res.count)}: <b class="num">${money(res.total)}</b></p>`);
    mount($('#rows', host), res.items.length ? html`<div class="tablewrap"><table class="data"><thead><tr><th>${t('date')}</th><th>${t('category')}</th>
      <th>${isExp ? t('vendor') : t('customerSource')}</th><th>${t('description')}</th><th>${t('amount')}</th><th></th></tr></thead>
      <tbody>${res.items.map((x) => html`<tr><td>${dateShort(isExp ? x.spentOn : x.receivedOn)}</td><td>${x.icon || ''} ${nm(x)}${x.source === 'recurring' ? html` <span class="pill">${t('recurringShort')}</span>` : ''}</td>
        <td>${isExp ? x.vendor || '' : x.source || ''}</td><td>${x.description || ''}${x.documentId ? html` <a href="${docUrl(x.documentId)}" target="_blank" rel="noopener">📎</a>` : ''}</td>
        <td class="num ${x.kind === 'refund' ? 'bad' : ''}">${x.kind === 'refund' ? '− ' : ''}${money(x.amount)}</td>
        <td class="row-gap">${manage ? html`<button class="btn small ghost" type="button" data-edit="${x.id}">${t('edit')}</button><button class="btn small ghost" type="button" data-arch="${x.id}">${t('archive')}</button>` : ''}
          <button class="btn small ghost" type="button" data-hist="${x.id}">${t('history')}</button></td></tr>`)}</tbody></table></div>`
      : empty(isExp ? t('noExpensesInRange') : t('noRevenueInRange')));
    $('#rows', host).onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const item = res.items.find((x) => x.id === (b.dataset.edit || b.dataset.arch || b.dataset.hist));
      if (b.dataset.edit) editRecord(ctx, kind, item, load);
      if (b.dataset.arch) {
        formSheet({
          title: t('archiveQ'), intro: t('archiveBody'), danger: true, submitLabel: t('archive'),
          fields: [{ name: 'reason', label: t('reason'), type: 'text', required: true }],
          onSubmit: async (v) => { await api.post(bpath(`${isExp ? '/business-expenses' : '/revenue'}/${item.id}/archive`), { archived: true, reason: v.reason }); load(); },
        });
      }
      if (b.dataset.hist) showHistory(`${isExp ? '/business-expenses' : '/revenue'}/${item.id}/history`);
    };
  };
  dateRangeBar($('#range', host), `fin-${kind}`, range, (r) => { Object.assign(range, r); load(); });
  $('#q', host).addEventListener('input', debounce((e) => { f.q = e.target.value; load(); }, 300));
  $('#cat', host).onchange = (e) => { f.categoryId = e.target.value; load(); };
  $('#add', host)?.addEventListener('click', () => editRecord(ctx, kind, null, load));
  load().catch(toastError);
  if (query.get('new')) editRecord(ctx, kind, null, load);
}

function editRecord(ctx, kind, x, reload) {
  const isExp = kind === 'expense';
  const cats = isExp ? ctx.ecats : ctx.rcats;
  formSheet({
    title: x ? t('edit') : isExp ? t('addBusinessExpense') : t('addRevenue'),
    fields: [
      { name: 'amount', label: t('amount'), type: isExp ? 'money' : 'signedMoney', required: true, value: x?.amount, hint: isExp ? null : t('revenueAmountHint') },
      { name: 'date', label: t('date'), type: 'date', required: true, value: (isExp ? x?.spentOn : x?.receivedOn) || todayLocal() },
      { name: 'categoryId', label: t('category'), type: 'select', required: true, value: x?.categoryId || '', options: cats.map((c) => [c.id, `${c.icon || ''} ${nm(c)}`]) },
      isExp ? { name: 'vendor', label: t('vendor'), type: 'text', optional: true, value: x?.vendor || '' } : { name: 'source', label: t('customerSource'), type: 'text', optional: true, value: x?.source || '' },
      { name: 'description', label: t('description'), type: 'text', optional: true, value: x?.description || '' },
      { name: 'paymentMethod', label: t('paymentMethod'), type: 'select', optional: true, value: x?.paymentMethod || '', options: methodOptions() },
      isExp && ctx.depts.length ? { name: 'departmentId', label: t('department'), type: 'select', optional: true, value: x?.departmentId || '', options: ctx.depts.map((d) => [d.id, d.name]) } : null,
      isExp ? { name: 'documentId', label: t('receiptDocument'), type: 'file', optional: true, value: x?.documentId || '' } : null,
      { name: 'notes', label: t('notes'), type: 'textarea', optional: true, value: x?.notes || '', full: true },
      x ? { name: 'reason', label: t('reasonForChange'), type: 'text', required: true } : null,
    ],
    onSubmit: async (v) => {
      const body = { amount: v.amount, categoryId: v.categoryId, description: v.description, paymentMethod: v.paymentMethod, notes: v.notes };
      if (isExp) Object.assign(body, { spentOn: v.date, vendor: v.vendor, departmentId: v.departmentId || null, documentId: v.documentId || null });
      else Object.assign(body, { receivedOn: v.date, source: v.source });
      for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
      const path = isExp ? '/business-expenses' : '/revenue';
      if (x) await api.put(bpath(`${path}/${x.id}`), { ...body, reason: v.reason });
      else await api.post(bpath(path), body);
      reload();
    },
  });
}

async function showHistory(path) {
  const items = await api.get(bpath(path));
  openSheet({
    title: t('history'),
    body: html`<ol class="timeline">${items.map((h) => html`<li><b>${t(`hist_${h.changeType}`)}</b><span class="muted small">${h.changedBy || t('system')} · ${dateShort(h.createdAt)}</span>
      ${h.before && h.after && h.before.amount !== h.after.amount ? html`<span class="small num">${money(h.before.amount)} → ${money(h.after.amount)}</span>` : ''}
      ${h.reason ? html`<span class="small">“${h.reason}”</span>` : ''}</li>`)}</ol>`,
  });
}

// ---------- recurring ----------

async function recurring(ctx) {
  const { host } = ctx;
  const manage = can('business_expenses.manage');
  mount(host, skeletonRows(4));
  const [items, upcoming] = await Promise.all([api.get(bpath('/recurring-expenses')), api.get(bpath('/recurring-expenses/upcoming?days=90'))]);
  if (!host.isConnected) return;
  const every = (r) => (r.frequency === 'custom' ? t('everyNDays', { n: r.intervalCount }) : r.intervalCount > 1 ? t(`everyN_${r.frequency}`, { n: r.intervalCount }) : t(`freq_${r.frequency}`));
  mount(host, html`<div class="toolbar"><p class="muted grow">${t('recurringIntro')}</p>${manage ? html`<button class="btn primary" type="button" id="add">${ICON.plus}${t('addRecurring')}</button>` : ''}</div>
    <div class="cols"><section class="panel"><h2>${t('recurringExpenses')}</h2>
      ${items.length ? html`<div class="listbox">${items.map((r) => html`<div class="row ${r.active ? '' : 'muted'}"><span class="avatar">${r.icon || ICON.repeat}</span>
        <span class="mid"><span class="t1">${r.description}</span><span class="t2">${every(r)} · ${nm(r)}${r.active ? ` · ${t('nextOn', { date: dateShort(r.nextOn) })}` : ` · ${t('stopped')}`}</span></span>
        <span class="end"><b class="num">${money(r.amount)}</b>${manage ? html`<button class="btn small ghost" type="button" data-edit="${r.id}">${t('edit')}</button>` : ''}</span></div>`)}</div>` : empty(t('noRecurring'), t('noRecurringBody'))}</section>
    <section class="panel"><h2>${t('upcoming90')}</h2><p class="lead num">${money(upcoming.total)}</p>
      <dl class="kv">${Object.entries(upcoming.byMonth).map(([m, v]) => html`<dt>${new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-IQ' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`))}</dt><dd class="num">${money(v)}</dd>`)}</dl>
      <div class="listbox">${upcoming.items.slice(0, 12).map((i) => html`<div class="row"><span class="mid"><span class="t1">${i.description}</span><span class="t2">${dateShort(i.date)}</span></span><span class="end num">${money(i.amount)}</span></div>`)}</div></section></div>`);
  const edit = (r) => formSheet({
    title: r ? t('editRecurring') : t('addRecurring'),
    fields: [
      { name: 'description', label: t('description'), type: 'text', required: true, value: r?.description || '' },
      { name: 'amount', label: t('amount'), type: 'money', required: true, value: r?.amount },
      { name: 'categoryId', label: t('category'), type: 'select', required: true, value: r?.categoryId || '', options: ctx.ecats.map((c) => [c.id, `${c.icon || ''} ${nm(c)}`]) },
      { name: 'vendor', label: t('vendor'), type: 'text', optional: true, value: r?.vendor || '' },
      r ? null : { name: 'frequency', label: t('frequency'), type: 'seg', full: true, value: 'monthly', options: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'].map((k) => [k, t(`freq_${k}`)]) },
      r ? null : { name: 'intervalCount', label: t('repeatEvery'), type: 'number', value: 1, hint: t('repeatEveryHint') },
      r ? null : { name: 'startOn', label: t('firstPayment'), type: 'date', required: true, value: todayLocal() },
      { name: 'endOn', label: t('lastPayment'), type: 'date', optional: true, value: r?.endOn || '' },
      { name: 'paymentMethod', label: t('paymentMethod'), type: 'select', optional: true, value: r?.paymentMethod || '', options: methodOptions() },
      r ? { name: 'active', label: t('activeRecurring'), type: 'checkbox', value: r.active } : null,
    ],
    onSubmit: async (v) => {
      const body = { ...v, intervalCount: v.intervalCount || 1 };
      for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === null) delete body[k];
      if (r) await api.put(bpath(`/recurring-expenses/${r.id}`), { ...body, endOn: v.endOn || null });
      else await api.post(bpath('/recurring-expenses'), body);
      toast(t('saved'));
      recurring(ctx);
    },
  });
  $('#add', host)?.addEventListener('click', () => edit(null));
  host.onclick = (e) => { const b = e.target.closest('[data-edit]'); if (b) edit(items.find((x) => x.id === b.dataset.edit)); };
}

// ---------- budgets ----------

async function budgets(ctx) {
  const { host } = ctx;
  const manage = can('budgets.manage');
  mount(host, skeletonRows(4));
  const list = await api.get(bpath('/budgets'));
  if (!host.isConnected) return;
  const label = (b) => (b.scope === 'category' ? `${b.icon || ''} ${nm(b)}` : t(`budget_${b.scope}`));
  mount(host, html`<div class="toolbar"><p class="muted grow">${t('budgetsIntro')}</p>${manage ? html`<button class="btn primary" type="button" id="add">${ICON.plus}${t('addBudget')}</button>` : ''}</div>
    ${list.length ? html`<section class="panel"><div class="bars">${list.map((b) => {
    const state = b.used >= 1 ? 'over' : b.used >= 0.8 ? 'warn' : '';
    return html`<div class="barrow"><span class="name"><b>${label(b)}</b> <small class="muted">${t(`period_${b.period}`)}</small></span>
      <span class="amt num">${money(b.actual)} / ${money(b.amount)}</span>
      <span class="track"><span class="bar ${state}" data-v="${Math.min(1, b.used)}"></span></span>
      <span class="small ${state ? 'bad' : 'muted'} num">${state === 'over' ? `⚠ ${t('overBy', { a: money(-b.remaining) })}` : `${pct(b.used)} ${t('used')} · ${t('left', { a: money(b.remaining) })}`}</span>
      ${manage ? html`<span class="row-gap"><button class="btn small ghost" type="button" data-edit="${b.id}">${t('edit')}</button></span>` : ''}</div>`;
  })}</div></section>` : empty(t('noBudgets'), t('noBudgetsBody'))}`);
  // Bars grow in.
  requestAnimationFrame(() => host.querySelectorAll('.bar[data-v]').forEach((b) => b.style.setProperty('--v', b.dataset.v)));
  $('#add', host)?.addEventListener('click', () => formSheet({
    title: t('addBudget'),
    fields: [
      { name: 'scope', label: t('budgetFor'), type: 'seg', value: 'category', full: true, options: [['category', t('budget_category')], ['payroll', t('budget_payroll')], ['total', t('budget_total')]] },
      { name: 'categoryId', label: t('category'), type: 'select', optional: true, options: ctx.ecats.map((c) => [c.id, `${c.icon || ''} ${nm(c)}`]), hint: t('budgetCategoryHint') },
      { name: 'period', label: t('period'), type: 'seg', value: 'monthly', options: [['monthly', t('period_monthly')], ['quarterly', t('period_quarterly')], ['yearly', t('period_yearly')]] },
      { name: 'amount', label: t('amount'), type: 'money', required: true },
    ],
    onSubmit: async (v) => {
      await api.post(bpath('/budgets'), { scope: v.scope, categoryId: v.scope === 'category' ? v.categoryId : undefined, period: v.period, amount: v.amount });
      budgets(ctx);
    },
  }));
  host.onclick = async (e) => {
    const b = e.target.closest('[data-edit]');
    if (!b) return;
    const cur = list.find((x) => x.id === b.dataset.edit);
    formSheet({
      title: label(cur),
      fields: [{ name: 'amount', label: t('amount'), type: 'money', required: true, value: cur.amount }, { name: 'active', label: t('activeBudget'), type: 'checkbox', value: true }],
      onSubmit: async (v) => {
        if (!v.active && !(await confirmDialog({ title: t('stopBudgetQ'), confirm: t('stopBudget') }))) return false;
        await api.put(bpath(`/budgets/${cur.id}`), { amount: v.amount, active: v.active });
        budgets(ctx);
      },
    });
  };
}
