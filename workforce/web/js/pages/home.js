// Home: a dashboard for each role (spec §23, §38-41).
import { api } from '../api.js';
import { t, tn } from '../i18n.js';
import { ICON, guilloche } from '../icons.js';
import { S, bpath, can, isOwner } from '../state.js';
import { dayLabel, hours, money, moneyShort, num, presetRange, shiftRange, time, todayLocal } from '../fmt.js';
import { chartCard, lineChart } from '../charts.js';
import { empty, kpiTile, statusPill, waitingOnMe } from '../components.js';
import { busy, toast, toastError } from '../ui.js';
import { noticeText } from './notifications.js';
import { $, LS, html, mount } from '../util.js';

let drawn = false;

function greeting(name) {
  const h = new Date().getHours();
  return t(h < 12 ? 'goodMorning' : h < 18 ? 'goodAfternoon' : 'goodEvening', { name: String(name).split(/\s+/)[0] });
}

const tile = (href, icon, label) => html`<a class="tile" href="#${href}"><span class="ic">${icon}</span><span>${label}</span></a>`;

export const homePage = {
  title: () => t('home'),
  render(view) {
    const b = S.business;
    const draw = !drawn;
    drawn = true;
    mount(view, html`
      <section class="note ${draw ? 'draw' : ''}" aria-labelledby="hero-name">${guilloche()}
        <div class="lbl">${greeting(S.me.user.name)}</div>
        <div class="big" id="hero-name">${b.name}</div>
        <div class="meta"><span class="chip">${t(`role_${b.role}`)}</span><span class="chip num" id="hero-chip" hidden></span></div>
      </section>
      <div id="home-body"><div class="skeleton sk-panel"></div></div>`);
    const body = $('#home-body', view);
    const job = isOwner() || can('finance.view') ? ownerHome : can('schedules.view') ? managerHome : employeeHome;
    job(view, body).catch((err) => { if (body.isConnected) toastError(err); });
  },
};

// ---------- employee ----------

async function employeeHome(view, body) {
  const [week, pay, claims, notes] = await Promise.all([
    api.get(bpath('/me/week')),
    can('self.pay') ? api.get(bpath('/me/pay')).catch(() => null) : null,
    can('self.expenses') ? api.get(bpath('/employee-expenses?mine=true')).catch(() => []) : [],
    api.get(bpath('/notifications?limit=3')).catch(() => null),
  ]);
  if (!body.isConnected) return;
  const chip = $('#hero-chip', view);
  chip.textContent = `${hours(week.scheduledHours)} · ${t('thisWeek')}`;
  chip.hidden = false;
  const todayShift = week.today[0];
  const clocked = week.clockedIn;
  const pendingClaims = claims.filter((c) => ['submitted', 'under_review'].includes(c.status)).length;
  const current = pay?.current;
  mount(body, html`
    <div class="cols"><div>
      <section class="panel today">
        <div class="panel-head"><h2>${t('today')}</h2>${clocked ? html`<span class="pill ok">● ${t('clockedInSince', { time: time(clocked.since) })}</span>` : ''}</div>
        ${todayShift ? html`<div class="shift-big"><span class="ic">${ICON.clock}</span><div>
            <b class="num">${time(todayShift.startsAt)} – ${time(todayShift.endsAt)}</b>
            <span class="muted">${[todayShift.departmentName, todayShift.locationName, todayShift.breakMinutes ? t('breakMin', { n: todayShift.breakMinutes }) : null].filter(Boolean).join(' · ')}</span>
          </div></div>` : html`<p class="muted">${t('noShiftToday')}</p>`}
        <button class="btn ${clocked ? '' : 'primary'} block" type="button" id="clock">${ICON.clock}${clocked ? t('clockOut') : t('clockIn')}</button>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>${t('thisWeek')}</h2><a class="btn small ghost" href="#/schedule">${t('seeAll')}</a></div>
        <div class="mini-stats">
          <div><small>${t('scheduled')}</small><b class="num">${hours(week.scheduledHours)}</b></div>
          <div><small>${t('worked')}</small><b class="num">${hours(week.workedHours)}</b></div>
          <div><small>${t('completedShifts')}</small><b class="num">${num(week.completedShifts, 0)}</b></div>
          <div><small>${t('rescheduled')}</small><b class="num">${num(week.rescheduledShifts, 0)}</b></div>
        </div>
        ${week.shifts.length ? html`<div class="listbox">${week.shifts.map((s) => html`<a class="row" href="#/schedule?shift=${s.id}">
            <span class="mid"><span class="t1">${dayLabel(s.startsAt)}</span><span class="t2 num">${time(s.startsAt)} – ${time(s.endsAt)}</span></span>
            <span class="end">${s.rescheduled ? html`<span class="pill info">${t('st_rescheduled')}</span>` : ''}${statusPill(s.status === 'scheduled' && new Date(s.endsAt) < Date.now() ? 'completed' : s.status)}</span></a>`)}</div>`
          : empty(t('noShiftsWeek'))}
        ${week.next && !week.today.some((s) => s.id === week.next.id) ? html`<p class="small muted">${t('nextShift')}: <b>${shiftRange(week.next)}</b></p>` : ''}
      </section>
    </div><div>
      ${current ? html`<a class="panel pay-card" href="#/pay"><small class="muted">${t('payThisPeriod')}</small>
        <b class="big num">${money(current.net)}</b>${statusPill(current.status)}</a>` : ''}
      <section class="panel"><h2>${t('requestsAndSwaps')}</h2>
        <div class="mini-stats">
          <div><small>${t('st_pending')}</small><b class="num">${num(week.requests.pending + week.swaps.pending, 0)}</b></div>
          <div><small>${t('st_approved')}</small><b class="num">${num(week.requests.approved + week.swaps.approved, 0)}</b></div>
          <div><small>${t('expensesWaiting')}</small><b class="num">${num(pendingClaims, 0)}</b></div>
        </div>
        ${week.swaps.waiting_on_me ? html`<a class="banner info" href="#/requests"><span>${tn('swapsWaitingOnYou', week.swaps.waiting_on_me)}</span><span class="chev">${ICON.chev}</span></a>` : ''}
      </section>
      ${notes?.items.length ? html`<section class="panel"><div class="panel-head"><h2>${t('notifications')}</h2><a class="btn small ghost" href="#/notifications">${t('seeAll')}</a></div>
        <div class="listbox">${notes.items.map((n) => html`<a class="row" href="#/notifications"><span class="mid"><span class="t1">${noticeText(n)}</span></span></a>`)}</div></section>` : ''}
    </div></div>
    <h2 class="h2">${t('quickActions')}</h2>
    <div class="tiles">
      ${tile('/schedule', ICON.calendar, t('mySchedule'))}
      ${can('self.requests') ? tile('/requests?new=change', ICON.clock, t('requestChange')) : ''}
      ${can('self.swaps') ? tile('/requests?new=swap', ICON.swap, t('swapShift')) : ''}
      ${can('self.pay') ? tile('/pay', ICON.wallet, t('myPay')) : ''}
      ${can('self.expenses') ? tile('/expenses?new=1', ICON.receipt, t('addExpense')) : ''}
      ${tile('/notifications', ICON.bell, t('notifications'))}
      ${tile('/account', ICON.user, t('profile'))}
    </div>`);
  $('#clock', body).onclick = async (e) => {
    busy(e.currentTarget);
    try {
      if (clocked) await api.post(bpath('/attendance/clock-out'), {});
      else await api.post(bpath('/attendance/clock-in'), {});
      toast(clocked ? t('clockedOut') : t('clockedIn'));
      homePage.render(view);
    } catch (err) {
      busy(e.currentTarget, false);
      toastError(err);
    }
  };
}

// ---------- manager ----------

async function managerHome(view, body) {
  const [today, requests, swaps, claims] = await Promise.all([
    api.get(bpath('/staffing/today')),
    can('shift_requests.approve') ? api.get(bpath('/shift-requests?status=pending')) : [],
    can('swaps.approve') ? api.get(bpath('/swaps?status=pending_approval')) : [],
    can('employee_expenses.review') ? api.get(bpath('/employee-expenses')).then((l) => l.filter(waitingOnMe)) : [],
  ]);
  if (!body.isConnected) return;
  const T = today.totals;
  const waiting = requests.filter((r) => r.type !== 'offer' || r.takerMembershipId).length + swaps.length + claims.length;
  const chip = $('#hero-chip', view);
  chip.textContent = tn('workingNow', T.working);
  chip.hidden = false;
  mount(body, html`
    <div class="stat-row">
      ${[['scheduled', T.scheduled, ''], ['working', T.working, 'ok'], ['late', T.late, 'warn'], ['missed', T.missed, 'over'], ['open', T.open, '']].map(([k, n, cls]) =>
    html`<div class="stat ${cls}"><small>${t(`staff_${k}`)}</small><b class="num">${num(n, 0)}</b></div>`)}
    </div>
    ${waiting ? html`<a class="banner info" href="#/approvals"><span>${tn('approvalsWaiting', waiting)}</span><span class="btn small">${t('review')}</span></a>` : ''}
    <div class="cols"><section class="panel"><div class="panel-head"><h2>${t('todaysStaffing')}</h2><a class="btn small ghost" href="#/schedule">${t('schedule')}</a></div>
      ${today.shifts.length ? html`<div class="listbox">${today.shifts.map((s) => html`<div class="row">
          <span class="avatar" aria-hidden="true">${(s.memberName || '·')[0]}</span>
          <span class="mid"><span class="t1">${s.memberName || t('openShift')}</span><span class="t2 num">${time(s.startsAt)} – ${time(s.endsAt)}${s.departmentName ? ` · ${s.departmentName}` : ''}</span></span>
          <span class="end">${statusPill(s.state)}</span></div>`)}</div>` : empty(t('noShiftsToday'))}
    </section>
    <section class="panel"><h2>${t('waitingForYou')}</h2>
      <div class="listbox">
        <a class="row" href="#/approvals?tab=requests"><span class="mid"><span class="t1">${t('shiftRequests')}</span></span><span class="pill warn num">${requests.length}</span></a>
        <a class="row" href="#/approvals?tab=swaps"><span class="mid"><span class="t1">${t('swaps')}</span></span><span class="pill warn num">${swaps.length}</span></a>
        <a class="row" href="#/approvals?tab=expenses"><span class="mid"><span class="t1">${t('employeeExpenses')}</span></span><span class="pill warn num">${claims.length}</span></a>
      </div></section></div>
    <h2 class="h2">${t('quickActions')}</h2>
    <div class="tiles">
      ${tile('/schedule', ICON.calendar, t('schedule'))}
      ${tile('/approvals', ICON.approve, t('approvals'))}
      ${can('attendance.view') ? tile('/attendance', ICON.clock, t('attendance')) : ''}
      ${can('members.view') ? tile('/team', ICON.people, t('team')) : ''}
      ${can('analytics.view') ? tile('/analytics', ICON.chart, t('analytics')) : ''}
      ${tile('/requests', ICON.swap, t('myRequests'))}
    </div>`);
}

// ---------- owner ----------

async function ownerHome(view, body) {
  const [from, to] = presetRange('thisMonth');
  const [ov, alerts, members, runs] = await Promise.all([
    api.get(bpath(`/analytics/overview?from=${from}&to=${to}`)),
    api.get(bpath('/alerts')).catch(() => []),
    can('members.view') ? api.get(bpath('/members?limit=1')).catch(() => null) : null,
    can('payroll.view') ? api.get(bpath('/payroll/runs')).catch(() => []) : [],
  ]);
  if (!body.isConnected) return;
  const k = ov.kpis;
  const chip = $('#hero-chip', view);
  chip.textContent = t('monthToDate');
  chip.hidden = false;
  const tiles = [
    kpiTile({ label: t('profit'), value: k.profit.value, change: k.profit.change, big: true }),
    kpiTile({ label: t('revenue'), value: k.revenue.value, change: k.revenue.change }),
    kpiTile({ label: t('expenses'), value: k.expenses.value, change: k.expenses.change, goodWhenUp: false }),
    kpiTile({ label: t('payroll'), value: k.payroll.value, change: k.payroll.change, goodWhenUp: false }),
    kpiTile({ label: t('profitMargin'), value: k.margin.value, change: k.margin.change, kind: 'pct' }),
    kpiTile({ label: t('activeEmployees'), value: k.activeEmployees.value, kind: 'int' }),
  ];
  const nextRun = runs.find((r) => r.status !== 'paid');
  const u = S.me.user;
  const steps = [
    { done: u.twoFactorEnabled, label: t('step2fa'), href: '/account?focus=2fa' },
    { done: (members?.total || 0) > 1, label: t('stepInvite'), href: '/team?invite=1' },
    { done: !!LS.get(`perms-reviewed:${S.business.id}`), label: t('stepPerms'), href: '/permissions' },
    { done: ov.pnl.revenue.total > 0 || ov.pnl.expenses.total > 0, label: t('stepMoney'), href: '/finance' },
  ];
  mount(body, html`
    <h2 class="h2">${t('howIsBusiness')}</h2>
    <div class="kpis">${tiles.map((x) => x.tpl)}</div>
    ${alerts.slice(0, 3).map((a) => html`<a class="banner ${a.severity === 'critical' ? '' : 'info'}" href="#/analytics"><span>⚠ ${t(`n.alert.${a.type}`, a.data)}</span><span class="chev">${ICON.chev}</span></a>`)}
    <div class="cols">
      <section class="panel" id="rev-chart"></section>
      <div>
        ${nextRun ? html`<a class="panel pay-card" href="#/payroll?run=${nextRun.id}"><small class="muted">${t('upcomingPayroll')}</small>
          <b class="big num">${money(nextRun.net)}</b><span class="muted small">${dayLabel(nextRun.periodStart)} – ${dayLabel(nextRun.periodEnd)}</span>${statusPill(nextRun.status)}</a>` : ''}
        ${steps.every((s) => s.done) ? '' : html`<section class="panel"><h2>${t('setupTitle')}</h2><ul class="checklist">
          ${steps.map((s) => html`<li class="${s.done ? 'done' : ''}"><span class="tick">${s.done ? ICON.check : ''}</span><span class="txt">${s.label}</span>
            ${s.done ? '' : html`<a class="btn small" href="#${s.href}">${t('continue')}</a>`}</li>`)}</ul></section>`}
      </div>
    </div>
    <h2 class="h2">${t('quickActions')}</h2>
    <div class="tiles">
      ${tile('/finance?new=expense', ICON.receipt, t('addBusinessExpense'))}
      ${tile('/finance?tab=revenue&new=revenue', ICON.money, t('addRevenue'))}
      ${tile('/analytics', ICON.chart, t('analytics'))}
      ${tile('/payroll', ICON.pay, t('payroll'))}
      ${tile('/approvals', ICON.approve, t('approvals'))}
      ${tile('/reports', ICON.file, t('reports'))}
    </div>`);
  tiles.forEach((x) => x.animate(body));
  const box = chartCard($('#rev-chart', body), {
    title: t('revenueVsExpenses'),
    legend: [{ label: t('revenue'), slot: 0 }, { label: t('expenses'), slot: 1 }],
    table: { columns: [t('date'), t('revenue'), t('expenses'), t('profit')], rows: ov.series.filter((p) => p.start <= todayLocal()).map((p) => [dayLabel(p.start), money(p.revenue), money(p.expenses), money(p.profit)]) },
  });
  // Running totals stop at today; the rest of the month hasn't happened yet.
  const now = todayLocal();
  const past = ov.series.filter((p) => p.start <= now);
  lineChart(box, {
    labels: past.map((p) => dayLabel(p.start, { day: 'numeric', month: 'short' })),
    tipLabel: (i) => dayLabel(past[i].start),
    series: [
      { label: t('revenue'), slot: 0, values: cumulative(past.map((p) => p.revenue)) },
      { label: t('expenses'), slot: 1, values: cumulative(past.map((p) => p.expenses)) },
    ],
    format: money,
    axisFormat: moneyShort,
  });
}

// Running totals read better than daily spikes for "month so far".
function cumulative(values) {
  let s = 0;
  return values.map((v) => (s += v));
}
