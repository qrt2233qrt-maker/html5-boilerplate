// Analytics centre (spec §11, §14, §24) and smart alerts (spec §25).
// Everything is computed from stored records on the server.
import { badRequest } from '../lib/errors.js';
import { assertRange, business, managedScope, scopeSql } from '../lib/context.js';
import { notify } from '../lib/notify.js';
import { listBudgets, profitAndLoss, today } from './finance.js';

const DAY = 86400000;
const addDays = (s, n) => new Date(Date.parse(s) + n * DAY).toISOString().slice(0, 10);
const span = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
const change = (cur, prev) => (prev ? (cur - prev) / Math.abs(prev) : null);

// The period to compare [from, to] with. A range starting on the 1st of a
// month (this month, last month, quarter, year, or month-to-date) is
// compared with the same days one calendar step back, so "1–2 October"
// is set against "1–2 September" and a quarter against the quarter before.
// Anything else is compared with the equal-length period just before it.
export function previousRange(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  if (fd === 1) {
    const [ty, tm, td] = to.split('-').map(Number);
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    const step = months <= 1 ? 1 : months <= 3 ? 3 : 12;
    const shift = (y, m, d) => {
      const first = new Date(Date.UTC(y, m - 1 - step, 1));
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
    };
    // A range ending on a month's last day ends on the last day there too.
    const monthEnd = td === new Date(Date.UTC(ty, tm, 0)).getUTCDate();
    if (months <= 12) return [shift(fy, fm, 1), shift(ty, tm, monthEnd ? 31 : td)];
  }
  const n = span(from, to);
  return [addDays(from, -n), addDays(from, -1)];
}

function bucketOf(from, to) {
  const n = span(from, to);
  return n <= 45 ? 'day' : n <= 200 ? 'week' : 'month';
}

// Revenue, expenses and profit per day/week/month.
async function series(db, biz, from, to, bucket) {
  const unit = bucket;
  const { rows } = await db.query(
    `WITH b AS (
       SELECT generate_series(date_trunc($4, $2::date), date_trunc($4, $3::date), ('1 ' || $4)::interval)::date AS start
     ), rev AS (
       SELECT date_trunc($4, v.received_on)::date AS start, sum(CASE WHEN c.kind = 'refund' THEN -v.amount ELSE v.amount END) AS amount
         FROM revenues v JOIN revenue_categories c ON c.id = v.category_id
        WHERE v.business_id = $1 AND v.archived_at IS NULL AND v.received_on BETWEEN $2 AND $3 GROUP BY 1
     ), exp AS (
       SELECT date_trunc($4, spent_on)::date AS start, sum(amount) AS amount FROM (
         SELECT spent_on, amount FROM business_expenses WHERE business_id = $1 AND archived_at IS NULL AND spent_on BETWEEN $2 AND $3
         UNION ALL
         SELECT spent_on, amount FROM employee_expenses WHERE business_id = $1 AND status IN ('approved', 'reimbursed') AND spent_on BETWEEN $2 AND $3
       ) x GROUP BY 1
     ), pay AS (
       SELECT date_trunc($4, r.period_end)::date AS start, sum(i.amount) AS amount
         FROM payroll_runs r JOIN payroll_items i ON i.run_id = r.id
        WHERE r.business_id = $1 AND r.status IN ('finalized', 'paid') AND r.period_end BETWEEN $2 AND $3
          AND i.kind IN ('base', 'overtime', 'trips', 'bonus', 'adjustment') GROUP BY 1
     )
     SELECT b.start::text, coalesce(rev.amount, 0)::bigint AS revenue, coalesce(exp.amount, 0)::bigint AS expenses, coalesce(pay.amount, 0)::bigint AS payroll
       FROM b LEFT JOIN rev USING (start) LEFT JOIN exp USING (start) LEFT JOIN pay USING (start) ORDER BY b.start`,
    [biz.id, from, to, unit]);
  return rows.map((r) => {
    const expenses = Number(r.expenses) + Number(r.payroll);
    return { start: r.start, revenue: Number(r.revenue), expenses, payroll: Number(r.payroll), profit: Number(r.revenue) - expenses };
  });
}

// Owner dashboard: "How is my business doing?" (spec §40-41).
export async function overview(app, req, { from, to, bucket }) {
  assertRange(from, to);
  const biz = await business(req);
  // A range running into the future (this month, this year) is compared
  // up to today only, so a month two days old isn't set against a full one.
  const now = await today(app.db, biz);
  const [pf, pt] = previousRange(from, to > now && now >= from ? now : to);
  const [cur, prev] = await Promise.all([profitAndLoss(app.db, biz.id, from, to), profitAndLoss(app.db, biz.id, pf, pt)]);
  const b = bucket || bucketOf(from, to);
  const { rows: [people] } = await app.db.query(
    'SELECT count(*) FILTER (WHERE status = \'active\' AND role <> \'owner\')::int AS active FROM memberships WHERE business_id = $1', [biz.id]);
  const kpi = (c, p) => ({ value: c, previous: p, change: change(c, p) });
  return {
    from, to, previousFrom: pf, previousTo: pt, bucket: b,
    kpis: {
      revenue: kpi(cur.revenue.total, prev.revenue.total),
      expenses: kpi(cur.expenses.total, prev.expenses.total),
      payroll: kpi(cur.laborCost, prev.laborCost),
      profit: kpi(cur.profit, prev.profit),
      margin: { value: cur.margin, previous: prev.margin, change: cur.margin !== null && prev.margin !== null ? cur.margin - prev.margin : null },
      payrollShare: { value: cur.revenue.total ? cur.laborCost / cur.revenue.total : null },
      activeEmployees: { value: people.active },
    },
    // Buckets stop at today: future days have nothing to show yet.
    series: await series(app.db, biz, from, to > now && now >= from ? now : to, b),
    expenseBreakdown: cur.expenses.byCategory,
    revenueBreakdown: cur.revenue.byCategory,
    payroll: {
      ...cur.payroll,
      averagePerEmployee: cur.payroll.employees ? Math.round(cur.payroll.gross / cur.payroll.employees) : 0,
    },
    pnl: cur,
  };
}

// One expense category over time, with its transactions (spec §14).
export async function drilldown(app, req, key, { from, to }) {
  assertRange(from, to);
  const biz = await business(req);
  const db = app.db;
  const [pf, pt] = previousRange(from, to);
  const trendFrom = `${addDays(to, -365).slice(0, 7)}-01`;
  let sql;
  let params;
  if (key === 'payroll') {
    sql = `SELECT r.period_end AS day, i.amount, u.name AS label, i.kind AS detail, r.id::text AS ref
             FROM payroll_runs r JOIN payroll_items i ON i.run_id = r.id JOIN memberships m ON m.id = i.membership_id JOIN users u ON u.id = m.user_id
            WHERE r.business_id = $1 AND r.status IN ('finalized', 'paid') AND i.kind IN ('base', 'overtime', 'trips', 'bonus', 'adjustment')
              AND r.period_end BETWEEN $2 AND $3`;
    params = [biz.id];
  } else if (key === 'employee_reimbursements') {
    sql = `SELECT e.spent_on AS day, e.amount, u.name AS label, e.description AS detail, e.id::text AS ref
             FROM employee_expenses e JOIN memberships m ON m.id = e.membership_id JOIN users u ON u.id = m.user_id
            WHERE e.business_id = $1 AND e.status IN ('approved', 'reimbursed') AND e.spent_on BETWEEN $2 AND $3`;
    params = [biz.id];
  } else {
    const { rows: [c] } = await db.query('SELECT id FROM expense_categories WHERE business_id = $1 AND (key = $2 OR id::text = $2)', [biz.id, key]);
    if (!c) throw badRequest('invalid_category', 'Unknown category.');
    sql = `SELECT x.spent_on AS day, x.amount, coalesce(x.vendor, '') AS label, x.description AS detail, x.id::text AS ref
             FROM business_expenses x WHERE x.business_id = $1 AND x.archived_at IS NULL AND x.category_id = $4 AND x.spent_on BETWEEN $2 AND $3`;
    params = [biz.id, c.id];
  }
  const run = (f, t2) => db.query(sql, params.length > 1 ? [params[0], f, t2, params[1]] : [params[0], f, t2]);
  const [{ rows: tx }, { rows: prevRows }, { rows: trendRows }, pnl] = await Promise.all([
    run(from, to), run(pf, pt), run(trendFrom, to), profitAndLoss(db, biz.id, from, to),
  ]);
  const total = tx.reduce((a, r) => a + Number(r.amount), 0);
  const previous = prevRows.reduce((a, r) => a + Number(r.amount), 0);
  const trend = {};
  for (const r of trendRows) {
    const m = (r.day instanceof Date ? r.day.toISOString() : String(r.day)).slice(0, 7);
    trend[m] = (trend[m] || 0) + Number(r.amount);
  }
  return {
    key, from, to, total, count: tx.length, previous, change: change(total, previous),
    share: pnl.expenses.total ? total / pnl.expenses.total : 0,
    monthly: Object.entries(trend).sort().map(([month, amount]) => ({ month, amount })),
    transactions: tx.sort((a, b) => String(b.day).localeCompare(String(a.day))).slice(0, 500).map((r) => ({
      date: (r.day instanceof Date ? r.day.toISOString() : String(r.day)).slice(0, 10), amount: Number(r.amount), label: r.label, detail: r.detail, ref: r.ref,
    })),
  };
}

// Costs per section of the business (kitchen, front of house, delivery …):
// expenses tagged to the section, staff claims and pay of the people who
// worked there. Costs not tagged to any section show as "Not assigned".
async function sectionCosts(db, bizId, from, to) {
  const { rows } = await db.query(
    `WITH exp AS (
       SELECT department_id, sum(amount)::bigint AS amount FROM business_expenses
        WHERE business_id = $1 AND archived_at IS NULL AND spent_on BETWEEN $2 AND $3 GROUP BY 1
     ), claims AS (
       SELECT department_id, sum(amount)::bigint AS amount FROM employee_expenses
        WHERE business_id = $1 AND status IN ('approved', 'reimbursed') AND spent_on BETWEEN $2 AND $3 GROUP BY 1
     ), labour AS (
       SELECT s.department_id, sum(i.amount)::bigint AS amount
         FROM payroll_runs r JOIN payroll_items i ON i.run_id = r.id
         JOIN payroll_statements s ON s.run_id = i.run_id AND s.membership_id = i.membership_id
        WHERE r.business_id = $1 AND r.status IN ('finalized', 'paid') AND r.period_end BETWEEN $2 AND $3
          AND i.kind IN ('base', 'overtime', 'trips', 'bonus', 'adjustment') GROUP BY 1
     ), ids AS (SELECT department_id FROM exp UNION SELECT department_id FROM claims UNION SELECT department_id FROM labour)
     SELECT ids.department_id::text AS id, coalesce(exp.amount, 0)::bigint AS expenses, coalesce(claims.amount, 0)::bigint AS claims, coalesce(labour.amount, 0)::bigint AS labour
       FROM ids LEFT JOIN exp ON exp.department_id IS NOT DISTINCT FROM ids.department_id
       LEFT JOIN claims ON claims.department_id IS NOT DISTINCT FROM ids.department_id
       LEFT JOIN labour ON labour.department_id IS NOT DISTINCT FROM ids.department_id`, [bizId, from, to]);
  return new Map(rows.map((r) => [r.id ?? 'none', { expenses: Number(r.expenses) + Number(r.claims), labour: Number(r.labour) }]));
}

export async function sections(app, req, { from, to }) {
  assertRange(from, to);
  const biz = await business(req);
  const db = app.db;
  const now = await today(db, biz);
  const end = to > now && now >= from ? now : to;
  const [pf, pt] = previousRange(from, end);
  const [cur, prev] = await Promise.all([sectionCosts(db, biz.id, from, to), sectionCosts(db, biz.id, pf, pt)]);
  const { rows: depts } = await db.query(
    `SELECT d.id::text, d.name, d.archived_at,
            (SELECT count(*) FROM memberships m WHERE m.department_id = d.id AND m.status = 'active')::int AS people
       FROM departments d WHERE d.business_id = $1 ORDER BY d.name`, [biz.id]);
  const params = [biz.id, from, to, biz.timezone];
  const { rows: work } = await db.query(
    `SELECT coalesce(m.department_id::text, 'none') AS id,
            coalesce(sum(extract(epoch FROM (a.clock_out - a.clock_in)) / 3600 - a.break_minutes / 60.0), 0)::float AS hours
       FROM attendance a JOIN memberships m ON m.id = a.membership_id
      WHERE a.business_id = $1 AND a.clock_out IS NOT NULL AND a.clock_in >= ($2::date)::timestamp AT TIME ZONE $4
        AND a.clock_in < (($3::date) + 1)::timestamp AT TIME ZONE $4 GROUP BY 1`, params);
  const { rows: trips } = await db.query(
    `SELECT coalesce(m.department_id::text, 'none') AS id, sum(t.trips)::int AS trips
       FROM delivery_trips t JOIN memberships m ON m.id = t.membership_id
      WHERE t.business_id = $1 AND t.day BETWEEN $2 AND $3 GROUP BY 1`, [biz.id, from, to]);
  // Expense categories within each section, biggest first.
  const { rows: cats } = await db.query(
    `SELECT coalesce(x.department_id::text, 'none') AS id, c.key, c.name_en, c.name_ar, c.icon, sum(x.amount)::bigint AS amount
       FROM business_expenses x JOIN expense_categories c ON c.id = x.category_id
      WHERE x.business_id = $1 AND x.archived_at IS NULL AND x.spent_on BETWEEN $2 AND $3
      GROUP BY 1, c.id ORDER BY amount DESC`, [biz.id, from, to]);
  const zero = { expenses: 0, labour: 0 };
  const list = [...depts, { id: 'none', name: null, archived_at: null, people: null }].map((d) => {
    const c = cur.get(d.id) ?? zero;
    const p = prev.get(d.id) ?? zero;
    const total = c.expenses + c.labour;
    const before = p.expenses + p.labour;
    return {
      id: d.id === 'none' ? null : d.id, name: d.name, archived: !!d.archived_at, people: d.people,
      expenses: c.expenses, labour: c.labour, total, previousTotal: before, change: change(total, before),
      hoursWorked: round(work.find((w) => w.id === d.id)?.hours ?? 0),
      trips: trips.find((x) => x.id === d.id)?.trips ?? 0,
      topCategories: cats.filter((x) => x.id === d.id).slice(0, 4).map((x) => ({ key: x.key, nameEn: x.name_en, nameAr: x.name_ar, icon: x.icon, amount: Number(x.amount) })),
    };
  }).filter((x) => x.total || x.previousTotal || (!x.archived && x.id));
  const total = list.reduce((a, x) => a + x.total, 0);
  for (const x of list) x.share = total ? x.total / total : 0;
  list.sort((a, b) => (a.id === null) - (b.id === null) || b.total - a.total);
  return { from, to, previousFrom: pf, previousTo: pt, total, sections: list };
}

// People and shift numbers. Managers who run departments see their own scope.
export async function workforce(app, req, { from, to }) {
  assertRange(from, to);
  const biz = await business(req);
  const params = [biz.id, from, to, biz.timezone];
  const scope = scopeSql(await managedScope(req), params);
  const db = app.db;
  const { rows: [people] } = await db.query(
    `SELECT count(*) FILTER (WHERE m.status <> 'archived' AND m.role <> 'owner')::int AS total,
            count(*) FILTER (WHERE m.status = 'active' AND m.role <> 'owner')::int AS active,
            count(*) FILTER (WHERE m.role <> 'owner' AND (m.created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3)::int AS new,
            count(*) FILTER (WHERE m.end_date BETWEEN $2 AND $3)::int AS terminated
       FROM memberships m WHERE m.business_id = $1 AND ${scope}`, params);
  const { rows: [shifts] } = await db.query(
    `SELECT coalesce(sum(extract(epoch FROM (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0) FILTER (WHERE s.status <> 'cancelled'), 0)::float AS scheduled_hours,
            coalesce(sum(extract(epoch FROM (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0) FILTER (WHERE s.status <> 'cancelled' AND s.ends_at <= now()), 0)::float AS past_hours,
            count(*) FILTER (WHERE s.status <> 'cancelled')::int AS shifts,
            count(*) FILTER (WHERE s.status = 'scheduled' AND s.ends_at < now() AND NOT EXISTS (
              SELECT 1 FROM attendance a WHERE a.membership_id = s.membership_id AND a.clock_in < s.ends_at AND coalesce(a.clock_out, now()) > s.starts_at))::int AS missed
       FROM shifts s JOIN memberships m ON m.id = s.membership_id
      WHERE s.business_id = $1 AND s.starts_at >= ($2::date)::timestamp AT TIME ZONE $4 AND s.starts_at < (($3::date) + 1)::timestamp AT TIME ZONE $4 AND ${scope}`, params);
  const { rows: [hours] } = await db.query(
    `SELECT coalesce(sum(extract(epoch FROM (a.clock_out - a.clock_in)) / 3600 - a.break_minutes / 60.0), 0)::float AS worked
       FROM attendance a JOIN memberships m ON m.id = a.membership_id
      WHERE a.business_id = $1 AND a.clock_out IS NOT NULL AND a.clock_in >= ($2::date)::timestamp AT TIME ZONE $4
        AND a.clock_in < (($3::date) + 1)::timestamp AT TIME ZONE $4 AND ${scope}`, params);
  const { rows: [changes] } = await db.query(
    `SELECT count(*) FILTER (WHERE h.change_type IN ('updated', 'reassigned', 'unassigned'))::int AS changes,
            count(*) FILTER (WHERE h.change_type = 'swapped')::int AS swap_moves
       FROM shift_history h JOIN shifts s ON s.id = h.shift_id LEFT JOIN memberships m ON m.id = s.membership_id
      WHERE h.business_id = $1 AND (h.created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 AND (s.membership_id IS NULL OR ${scope})`, params);
  const { rows: [ot] } = await db.query(
    `SELECT coalesce(sum(i.minutes), 0)::int / 60.0 AS hours, coalesce(sum(i.amount), 0)::bigint AS cost
       FROM payroll_runs r JOIN payroll_items i ON i.run_id = r.id JOIN memberships m ON m.id = i.membership_id
      WHERE r.business_id = $1 AND i.kind = 'overtime' AND r.period_end BETWEEN $2 AND $3 AND $4::text IS NOT NULL AND ${scope}`, params);
  return {
    employees: people,
    shifts: {
      count: shifts.shifts, scheduledHours: round(shifts.scheduled_hours), scheduledToDateHours: round(shifts.past_hours), workedHours: round(hours.worked), missed: shifts.missed,
      changes: changes.changes, swaps: Math.floor(changes.swap_moves / 2),
    },
    overtime: { hours: round(Number(ot.hours)), cost: Number(ot.cost) },
  };
}

const round = (n) => Math.round(n * 100) / 100;

// ---------- smart alerts ----------

const pct = (n) => Math.round(n * 1000) / 10;

/**
 * Month-to-date against the same days of last month, plus budgets and margin.
 * Thresholds come from settings.alerts (owner-configurable).
 */
export async function computeAlerts(db, biz) {
  const a = biz.settings.alerts;
  const day = await today(db, biz);
  const from = `${day.slice(0, 7)}-01`;
  const dom = Number(day.slice(8, 10));
  const prevMonthStart = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  const prevMonthDays = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, 0)).getUTCDate();
  const prevTo = addDays(prevMonthStart, Math.min(dom, prevMonthDays) - 1);
  const [cur, prev] = await Promise.all([profitAndLoss(db, biz.id, from, day), profitAndLoss(db, biz.id, prevMonthStart, prevTo)]);
  const month = day.slice(0, 7);
  const alerts = [];
  const push = (type, severity, data, key = type) => alerts.push({ type, severity, data, dedupeKey: `${key}:${month}` });

  const payChange = change(cur.laborCost, prev.laborCost);
  if (payChange !== null && payChange * 100 >= a.payrollIncreasePct) push('payroll_increase', 'warning', { pct: pct(payChange), current: cur.laborCost, previous: prev.laborCost });
  const revChange = change(cur.revenue.total, prev.revenue.total);
  if (revChange !== null && -revChange * 100 >= a.revenueDropPct) push('revenue_drop', 'critical', { pct: pct(-revChange), current: cur.revenue.total, previous: prev.revenue.total });
  for (const c of cur.expenses.byCategory) {
    if (c.key === 'payroll') continue;
    const p = prev.expenses.byCategory.find((x) => x.key === c.key);
    const ch = p ? change(c.amount, p.amount) : null;
    if (ch !== null && ch * 100 >= a.categoryIncreasePct) push('category_increase', 'warning', { key: c.key, nameEn: c.nameEn, nameAr: c.nameAr, pct: pct(ch), current: c.amount, previous: p.amount }, `category_increase:${c.key}`);
  }
  const otChange = change(cur.payroll.overtime, prev.payroll.overtime);
  if (otChange !== null && otChange * 100 >= a.overtimeIncreasePct) push('overtime_increase', 'warning', { pct: pct(otChange), current: cur.payroll.overtime, previous: prev.payroll.overtime });
  if (cur.margin !== null && cur.margin * 100 < a.marginBelowPct) push('margin_low', 'critical', { margin: pct(cur.margin), threshold: a.marginBelowPct });
  const budgets = await listBudgets(app0(db), { member: { businessId: biz.id }, _business: biz }, day);
  for (const b of budgets) {
    if (b.used >= 1) push('budget_over', 'critical', { scope: b.scope, categoryEn: b.categoryEn, categoryAr: b.categoryAr, amount: b.amount, actual: b.actual, period: b.period }, `budget_over:${b.id}`);
    else if (b.used >= 0.8) push('budget_near', 'warning', { scope: b.scope, categoryEn: b.categoryEn, categoryAr: b.categoryAr, amount: b.amount, actual: b.actual, used: pct(b.used) }, `budget_near:${b.id}`);
  }
  return alerts;
}

// listBudgets expects (app, req); the alert job has neither.
const app0 = (db) => ({ db });

export async function listAlerts(app, req) {
  const biz = await business(req);
  const live = await computeAlerts(app.db, biz);
  const { rows: dismissed } = await app.db.query('SELECT dedupe_key FROM alerts WHERE business_id = $1 AND dismissed_at IS NOT NULL', [biz.id]);
  const hidden = new Set(dismissed.map((d) => d.dedupe_key));
  return live.filter((x) => !hidden.has(x.dedupeKey));
}

export async function dismissAlert(app, req, dedupeKey) {
  await app.db.query(
    `INSERT INTO alerts (business_id, dedupe_key, type, dismissed_at) VALUES ($1, $2, split_part($2, ':', 1), now())
     ON CONFLICT (business_id, dedupe_key) DO UPDATE SET dismissed_at = now()`, [req.member.businessId, dedupeKey]);
}

// Background job: notify owners once about each new alert.
export async function scanAlerts(db) {
  const { rows: businesses } = await db.query('SELECT * FROM businesses WHERE archived_at IS NULL');
  const { settingsOf } = await import('../lib/context.js');
  let sent = 0;
  for (const b of businesses) {
    b.settings = settingsOf(b);
    for (const al of await computeAlerts(db, b)) {
      const ins = await db.query(
        `INSERT INTO alerts (business_id, dedupe_key, type, severity, data) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (business_id, dedupe_key) DO NOTHING RETURNING id`, [b.id, al.dedupeKey, al.type, al.severity, JSON.stringify(al.data)]);
      if (!ins.rows[0]) continue;
      const owners = await db.query('SELECT user_id FROM memberships WHERE business_id = $1 AND role = \'owner\' AND status = \'active\'', [b.id]);
      for (const o of owners.rows) await notify(db, { businessId: b.id, userId: o.user_id, type: `alert.${al.type}`, data: al.data });
      sent++;
    }
  }
  return sent;
}
