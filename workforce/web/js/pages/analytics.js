// Analytics centre (spec §11-14, §24-25, §40-41): headline numbers first,
// then charts, drill-downs, workforce numbers and smart alerts.
import { api } from '../api.js';
import { LANG, t } from '../i18n.js';
import { S, bpath, can } from '../state.js';
import { dateShort, dayLabel, hours, money, moneyShort, num, pct } from '../fmt.js';
import { barChart, chartCard, donut, lineChart } from '../charts.js';
import { dateRangeBar, empty, kpiTile, rangeState } from '../components.js';
import { openSheet, skeletonRows, toastError } from '../ui.js';
import { $, html, mount } from '../util.js';

const nm = (c) => (LANG === 'ar' ? c.nameAr : c.nameEn);
const bucketLabel = (start, bucket) => (bucket === 'month' ? dayLabel(start, { month: 'short', year: '2-digit' }) : dayLabel(start, { day: 'numeric', month: 'short' }));

export const analyticsPage = {
  title: () => t('analytics'),
  render(view) {
    const range = rangeState('analytics');
    mount(view, html`<div class="toolbar sticky-filters"><div id="range"></div></div><div id="body">${skeletonRows(6)}</div>`);
    const load = async (r) => {
      const body = $('#body', view);
      mount(body, html`<div class="skeleton sk-panel"></div><div class="skeleton sk-panel"></div>`);
      try {
        if (can('finance.view')) { await finance(body, r); await sections(body, r); } else body.innerHTML = '';
        if (can('analytics.view')) await workforce(body, r);
      } catch (err) { toastError(err); }
    };
    dateRangeBar($('#range', view), 'analytics', range, load);
    load(range);
  },
};

async function finance(body, r) {
  const [ov, alerts] = await Promise.all([api.get(bpath(`/analytics/overview?from=${r.from}&to=${r.to}`)), api.get(bpath('/alerts'))]);
  if (!body.isConnected) return;
  const k = ov.kpis;
  const tiles = [
    kpiTile({ label: t('profit'), value: k.profit.value, change: k.profit.change, big: true }),
    kpiTile({ label: t('revenue'), value: k.revenue.value, change: k.revenue.change }),
    kpiTile({ label: t('expenses'), value: k.expenses.value, change: k.expenses.change, goodWhenUp: false }),
    kpiTile({ label: t('laborCost'), value: k.payroll.value, change: k.payroll.change, goodWhenUp: false }),
    kpiTile({ label: t('profitMargin'), value: k.margin.value, change: k.margin.change, kind: 'pct' }),
    kpiTile({ label: t('payrollShare'), value: k.payrollShare.value, kind: 'pct' }),
  ];
  const s = ov.series;
  mount(body, html`
    <p class="muted small">${t('comparedWith', { from: dateShort(ov.previousFrom), to: dateShort(ov.previousTo) })}</p>
    <div class="kpis">${tiles.map((x) => x.tpl)}</div>
    ${alerts.length ? html`<section class="panel"><h2>${t('smartAlerts')}</h2>${alerts.map((a) => html`<div class="banner ${a.severity === 'critical' ? '' : 'info'}">
      <span>⚠ ${t(`n.alert.${a.type}`, { ...a.data, nameEn: a.data.nameEn, nameAr: a.data.nameAr })}</span>
      <button class="btn small ghost" type="button" data-dismiss="${a.dedupeKey}">${t('dismiss')}</button></div>`)}</section>` : ''}
    <div class="cols">
      <section class="panel" id="c-rev"></section>
      <section class="panel" id="c-sales"></section>
      <section class="panel" id="c-pl"></section>
      <section class="panel" id="c-exp"></section>
      <section class="panel"><h2>${t('payrollCost')}</h2>
        <div class="kpis small">
          <div class="kpi"><small>${t('totalPayroll')}</small><b class="num">${money(ov.payroll.gross)}</b></div>
          <div class="kpi"><small>${t('avgEmployeeCost')}</small><b class="num">${money(ov.payroll.averagePerEmployee)}</b></div>
          <div class="kpi"><small>${t('overtimeCost')}</small><b class="num">${money(ov.payroll.overtime)}</b></div>
          <div class="kpi"><small>${t('reimbursements')}</small><b class="num">${money(ov.payroll.reimbursements)}</b></div>
        </div>
      </section>
    </div>`);
  tiles.forEach((x) => x.animate(body));
  body.onclick = async (e) => {
    const d = e.target.closest('[data-dismiss]');
    if (d) { await api.post(bpath('/alerts/dismiss'), { key: d.dataset.dismiss }); d.closest('.banner').remove(); }
  };
  const labels = s.map((p) => bucketLabel(p.start, ov.bucket));
  lineChart(chartCard($('#c-rev', body), {
    title: t('revenueVsExpenses'), legend: [{ label: t('revenue'), slot: 0 }, { label: t('expenses'), slot: 1 }],
    table: { columns: [t('period'), t('revenue'), t('expenses'), t('profit')], rows: s.map((p, i) => [labels[i], money(p.revenue), money(p.expenses), money(p.profit)]) },
  }), { labels, tipLabel: (i) => labels[i], format: money, axisFormat: moneyShort, series: [{ label: t('revenue'), slot: 0, values: s.map((p) => p.revenue) }, { label: t('expenses'), slot: 1, values: s.map((p) => p.expenses) }] });
  barChart(chartCard($('#c-pl', body), {
    title: t('profitLossOverTime'),
    table: { columns: [t('period'), t('profit')], rows: s.map((p, i) => [labels[i], money(p.profit)]) },
  }), { labels, values: s.map((p) => p.profit), diverging: true, format: money, axisFormat: moneyShort, tipLabel: (i) => labels[i] });
  // Sales by channel (dine-in, takeaway, delivery …) — the revenue categories.
  const sales = ov.revenueBreakdown.filter((c) => c.amount > 0);
  const salesBox = chartCard($('#c-sales', body), {
    title: S.settingsInfo?.kind === 'restaurant' ? t('salesByChannel') : t('revenueByCategory'),
    table: { columns: [t('category'), t('amount')], rows: ov.revenueBreakdown.map((c) => [nm(c), money(c.amount)]) },
  });
  if (sales.length) donut(salesBox, { items: sales.map((c) => ({ key: c.key, label: nm(c), value: c.amount })), format: moneyShort, centerLabel: t('revenue') });
  else mount(salesBox, empty(t('noRevenueInRange')));
  const expBox = chartCard($('#c-exp', body), {
    title: t('expenseBreakdown'),
    table: { columns: [t('category'), t('amount'), t('share')], rows: ov.expenseBreakdown.map((c) => [nm(c), money(c.amount), pct(c.share, 1)]) },
  });
  if (ov.expenseBreakdown.length) {
    donut(expBox, {
      items: ov.expenseBreakdown.map((c) => ({ key: c.key, label: `${c.icon || ''} ${nm(c)}`, value: c.amount })),
      format: moneyShort, centerLabel: t('expenses'), onSelect: (it) => drill(it.key, it.label, r),
    });
    expBox.insertAdjacentHTML('beforeend', `<p class="hint">${t('drillHint')}</p>`);
  } else mount(expBox, empty(t('noExpensesInRange')));
}

// One category: total, trend, transactions, share, change (spec §14).
async function drill(key, label, r) {
  const d = await api.get(bpath(`/analytics/expenses/${encodeURIComponent(key)}?from=${r.from}&to=${r.to}`));
  const sheet = openSheet({
    title: label,
    body: html`<div class="kpis small">
        <div class="kpi"><small>${t('total')}</small><b class="num">${money(d.total)}</b>${d.change ? html`<span class="delta ${d.change > 0 ? 'bad' : 'good'}">${d.change > 0 ? '↑' : '↓'} ${pct(Math.abs(d.change), 1)}</span>` : d.change === 0 ? html`<span class="delta">= ${pct(0)}</span>` : ''}</div>
        <div class="kpi"><small>${t('transactions')}</small><b class="num">${num(d.count, 0)}</b></div>
        <div class="kpi"><small>${t('shareOfExpenses')}</small><b class="num">${pct(d.share, 1)}</b></div>
        <div class="kpi"><small>${t('previousPeriod')}</small><b class="num">${money(d.previous)}</b></div></div>
      <section id="d-trend"></section>
      <h3 class="h2 small">${t('transactions')}</h3>
      ${d.transactions.length ? html`<div class="listbox">${d.transactions.map((x) => html`<div class="row"><span class="mid"><span class="t1">${x.label || x.detail || '—'}</span><span class="t2">${dateShort(x.date)}${x.label && x.detail ? ` · ${x.detail}` : ''}</span></span><span class="end num">${money(x.amount)}</span></div>`)}</div>` : empty(t('noTransactions'))}`,
  });
  const months = d.monthly;
  barChart(chartCard(sheet.querySelector('#d-trend'), {
    title: t('monthlyTrend'), table: { columns: [t('month'), t('amount')], rows: months.map((m) => [m.month, money(m.amount)]) },
  }), { labels: months.map((m) => dayLabel(`${m.month}-01`, { month: 'short' })), values: months.map((m) => m.amount), format: money, axisFormat: moneyShort, slot: 0, tipLabel: (i) => months[i].month });
}

// What each section of the business costs: its own expenses and claims, and
// the pay of the people who worked there (spec §11, restaurant sections).
async function sections(body, r) {
  const d = await api.get(bpath(`/analytics/sections?from=${r.from}&to=${r.to}`));
  if (!body.isConnected) return;
  const host = document.createElement('section');
  host.className = 'panel';
  body.append(host);
  const name = (x) => x.name ?? t('notAssigned');
  const rows = d.sections;
  const box = chartCard(host, {
    title: t('costsBySection'), legend: [{ label: t('staffPay'), slot: 0 }, { label: t('otherCosts'), slot: 1 }],
    table: {
      columns: [t('section'), t('staffPay'), t('otherCosts'), t('total'), t('share'), t('change')],
      rows: rows.map((x) => [name(x), money(x.labour), money(x.expenses), money(x.total), pct(x.share, 1), x.change === null ? '—' : pct(x.change, 1)]),
    },
  });
  box.removeAttribute('dir');
  if (!rows.some((x) => x.total)) {
    mount(box, html`${empty(t('noSectionCosts'))}<p class="hint">${t('sectionHint')}</p>`);
    return;
  }
  const max = Math.max(...rows.map((x) => x.total), 1);
  mount(box, html`<div class="sections">${rows.map((x) => html`<div class="sec">
      <div class="sec-head"><b>${name(x)}</b><span class="num">${money(x.total)}</span>
        ${x.change === null ? '' : html`<span class="delta ${x.change > 0 ? 'bad' : x.change < 0 ? 'good' : ''}">${x.change > 0 ? '↑' : x.change < 0 ? '↓' : '='} ${pct(Math.abs(x.change), 0)}</span>`}</div>
      <div class="sec-bar" role="img" aria-label="${t('sectionBarLabel', { name: name(x), pay: money(x.labour), other: money(x.expenses) })}">
        <span class="seg s1" data-w="${(x.labour / max) * 100}"></span><span class="seg s2" data-w="${(x.expenses / max) * 100}"></span></div>
      <p class="t2 muted">${[
        x.total ? t('shareOfCosts', { p: pct(x.share, 0) }) : null,
        x.people !== null ? t('peopleCount', { n: num(x.people, 0) }) : null,
        x.hoursWorked ? hours(x.hoursWorked) : null,
        x.trips ? t('tripsCount', { n: num(x.trips, 0) }) : null,
        ...x.topCategories.slice(0, 3).map((c) => `${c.icon || ''} ${nm(c)} ${moneyShort(c.amount)}`),
      ].filter(Boolean).join(' · ')}</p></div>`)}</div>
    <p class="hint">${t('sectionHint')}</p>`);
  // Widths go through CSSOM: inline style attributes are blocked by the CSP.
  box.querySelectorAll('.seg').forEach((s) => s.style.setProperty('--w', `${s.dataset.w}%`));
}

async function workforce(body, r) {
  const w = await api.get(bpath(`/analytics/workforce?from=${r.from}&to=${r.to}`));
  if (!body.isConnected) return;
  const sec = document.createElement('section');
  sec.className = 'panel';
  mount(sec, html`<h2>${t('workforce')}</h2>
    <div class="kpis small">
      <div class="kpi"><small>${t('totalEmployees')}</small><b class="num">${num(w.employees.total, 0)}</b></div>
      <div class="kpi"><small>${t('activeEmployees')}</small><b class="num">${num(w.employees.active, 0)}</b></div>
      <div class="kpi"><small>${t('newEmployees')}</small><b class="num">${num(w.employees.new, 0)}</b></div>
      <div class="kpi"><small>${t('terminatedEmployees')}</small><b class="num">${num(w.employees.terminated, 0)}</b></div>
    </div>
    <h3 class="h2 small">${t('shiftAnalytics')}</h3>
    <div class="kpis small">
      <div class="kpi"><small>${t('scheduledHours')}</small><b class="num">${hours(w.shifts.scheduledHours)}</b></div>
      <div class="kpi"><small>${t('workedHours')}</small><b class="num">${hours(w.shifts.workedHours)}</b></div>
      <div class="kpi"><small>${t('missedShifts')}</small><b class="num">${num(w.shifts.missed, 0)}</b></div>
      <div class="kpi"><small>${t('shiftChanges')}</small><b class="num">${num(w.shifts.changes, 0)}</b></div>
      <div class="kpi"><small>${t('swaps')}</small><b class="num">${num(w.shifts.swaps, 0)}</b></div>
      <div class="kpi"><small>${t('overtime')}</small><b class="num">${hours(w.overtime.hours)}</b>${can('finance.view') ? html`<span class="muted small">${money(w.overtime.cost)}</span>` : ''}</div>
    </div>
    ${w.shifts.scheduledToDateHours ? html`<p class="hint">${t('workforceHint', { n: num((w.shifts.workedHours / w.shifts.scheduledToDateHours) * 100, 0) })}</p>` : ''}`);
  body.append(sec);
}
