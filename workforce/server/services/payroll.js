// Payroll runs (spec §6). Amounts are integer minor units; minutes are
// integers. Calculation only happens while a run is a draft; a paid run is
// locked and corrections go into a later run as adjustments.
import { transaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { auditB, business } from '../lib/context.js';
import { notifyMember } from '../lib/notify.js';
import { can } from '../auth/session.js';
import { today } from './finance.js';

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
const weekday = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();

// Start of the business week containing `day`.
export function weekStart(day, weekStartsOn) {
  return addDays(day, -((weekday(day) - weekStartsOn + 7) % 7));
}

// Pay period containing `day` for a frequency.
export function periodFor(day, { frequency, weekStartsOn }) {
  if (frequency === 'daily') return [day, day];
  if (frequency === 'monthly') {
    const start = `${day.slice(0, 7)}-01`;
    const [y, m] = day.split('-').map(Number);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return [start, end];
  }
  const ws = weekStart(day, weekStartsOn);
  if (frequency === 'weekly') return [ws, addDays(ws, 6)];
  // Two-week periods counted from a fixed anchor week so they never shift.
  const anchor = weekStart('2024-01-01', weekStartsOn);
  const weeks = Math.floor((Date.parse(ws) - Date.parse(anchor)) / (7 * 86400000));
  const start = addDays(ws, -7 * (((weeks % 2) + 2) % 2));
  return [start, addDays(start, 13)];
}

const daysInMonth = (day) => { const [y, m] = day.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
function* eachDay(from, to) { for (let d = from; d <= to; d = addDays(d, 1)) yield d; }

// Recomputes generated lines (base, overtime, trips, reimbursements) for a
// draft run. Each day belongs to the pay frequency of the rate in force that
// day, and a day already paid by another run is never paid again, so people
// can move between daily, weekly and monthly pay at any time.
async function calculate(db, biz, run, actorId) {
  const cfg = biz.settings.payroll;
  const start = iso(run.period_start);
  const end = iso(run.period_end);
  await db.query('UPDATE employee_expenses SET payroll_run_id = NULL WHERE payroll_run_id = $1', [run.id]);
  await db.query('DELETE FROM payroll_items WHERE run_id = $1 AND generated', [run.id]);
  await db.query('UPDATE payroll_statements SET days = \'{}\' WHERE run_id = $1', [run.id]);

  // Everyone employed for at least part of the period who has a pay rate.
  const { rows: people } = await db.query(
    `SELECT m.id, m.profile->>'startDate' AS start_date, m.end_date::text AS end_date FROM memberships m
      WHERE m.business_id = $1 AND (m.status IN ('active', 'suspended') OR (m.status IN ('terminated', 'archived') AND m.end_date >= $2))
        AND EXISTS (SELECT 1 FROM pay_rates p WHERE p.membership_id = m.id AND p.effective_from <= $3)`, [biz.id, start, end]);

  for (const p of people) {
    const { rows: rates } = await db.query(
      `SELECT pay_type, rate, frequency, effective_from::text AS from_day FROM pay_rates WHERE membership_id = $1 AND effective_from <= $2
        ORDER BY effective_from DESC, created_at DESC`, [p.id, end]);
    const rateOn = (day) => rates.find((r) => r.from_day <= day) || null;
    const { rows: [paid] } = await db.query(
      `SELECT coalesce(array_agg(DISTINCT d::text), '{}') AS days FROM payroll_statements s, unnest(s.days) d
        WHERE s.membership_id = $1 AND s.run_id <> $2 AND d BETWEEN $3 AND $4`, [p.id, run.id, start, end]);
    const already = new Set(paid.days);
    // The days this run pays for this person.
    const owned = [];
    for (const d of eachDay(start, end)) {
      if (p.start_date && d < p.start_date) continue;
      if (p.end_date && d > p.end_date) continue;
      const r = rateOn(d);
      if (r && (r.frequency || cfg.frequency) === run.frequency && !already.has(d)) owned.push(d);
    }
    if (!owned.length) continue;
    const ownedSet = new Set(owned);
    const items = [];

    // Salary: the monthly amount spread over the days of each month.
    let salary = 0;
    for (const d of owned) { const r = rateOn(d); if (r.pay_type === 'salaried') salary += r.rate / daysInMonth(d); }
    if (salary) items.push({ kind: 'base', amount: Math.round(salary), description: 'Salary' });

    // Hours, from closed attendance on owned days, with weekly overtime.
    // Minutes worked earlier in the same week (paid elsewhere) still count
    // towards the weekly limit, so daily pay doesn't dodge overtime.
    const { rows: days } = await db.query(
      `SELECT (clock_in AT TIME ZONE $4)::date::text AS day,
              sum(greatest(0, floor(extract(epoch FROM (clock_out - clock_in)) / 60) - break_minutes))::int AS minutes
         FROM attendance WHERE membership_id = $1 AND clock_out IS NOT NULL
          AND (clock_in AT TIME ZONE $4)::date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`,
      [p.id, addDays(weekStart(start, cfg.weekStartsOn), 0), end, biz.timezone]);
    const limit = cfg.overtimeWeeklyHours * 60;
    const weekUsed = new Map();
    let regMin = 0; let otMin = 0; let base = 0; let ot = 0;
    for (const d of days) {
      const wk = weekStart(d.day, cfg.weekStartsOn);
      const used = weekUsed.get(wk) || 0;
      weekUsed.set(wk, used + d.minutes);
      const r = rateOn(d.day);
      if (!ownedSet.has(d.day) || !r || r.pay_type !== 'hourly') continue;
      const reg = Math.max(0, Math.min(d.minutes, limit - used));
      const over = d.minutes - reg;
      regMin += reg; otMin += over;
      base += (r.rate * reg) / 60;
      ot += (r.rate * cfg.overtimeMultiplier * over) / 60;
    }
    if (regMin) items.push({ kind: 'base', amount: Math.round(base), minutes: regMin, description: 'Hours worked' });
    if (otMin) items.push({ kind: 'overtime', amount: Math.round(ot), minutes: otMin, description: `Overtime ×${cfg.overtimeMultiplier}` });

    // Delivery trips entered by a manager, at the per-trip rate of each day.
    const { rows: trips } = await db.query(
      'SELECT day::text AS day, trips FROM delivery_trips WHERE membership_id = $1 AND day BETWEEN $2 AND $3', [p.id, start, end]);
    let tripCount = 0; let tripPay = 0;
    for (const tr of trips) {
      const r = rateOn(tr.day);
      if (!ownedSet.has(tr.day) || !r || r.pay_type !== 'per_trip') continue;
      tripCount += tr.trips;
      tripPay += tr.trips * r.rate;
    }
    if (tripCount) items.push({ kind: 'trips', amount: tripPay, quantity: tripCount, description: 'Delivery trips' });

    // Approved work expenses not yet repaid.
    const { rows: claims } = await db.query(
      `UPDATE employee_expenses SET payroll_run_id = $2 WHERE membership_id = $1 AND status = 'approved' AND payroll_run_id IS NULL
          AND spent_on <= $3 RETURNING id, amount, description`, [p.id, run.id, end]);
    for (const c of claims) items.push({ kind: 'reimbursement', amount: c.amount, description: c.description, expenseId: c.id });

    for (const i of items) {
      await db.query(
        `INSERT INTO payroll_items (run_id, business_id, membership_id, kind, description, minutes, amount, generated, expense_id, created_by, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10)`,
        [run.id, biz.id, p.id, i.kind, i.description, i.minutes ?? null, i.amount, i.expenseId ?? null, actorId, i.quantity ?? null]);
    }
    await db.query(
      `INSERT INTO payroll_statements (run_id, membership_id, business_id, days) VALUES ($1, $2, $3, $4::date[])
       ON CONFLICT (run_id, membership_id) DO UPDATE SET days = EXCLUDED.days`, [run.id, p.id, biz.id, owned]);
  }
  // People no longer paid by this run (moved to another frequency) drop out,
  // unless someone added a bonus or deduction for them by hand.
  await db.query(
    `DELETE FROM payroll_statements s WHERE s.run_id = $1 AND cardinality(s.days) = 0
        AND NOT EXISTS (SELECT 1 FROM payroll_items i WHERE i.run_id = s.run_id AND i.membership_id = s.membership_id)`, [run.id]);
}

// Per-person totals for a run.
async function summary(db, runId, membershipId = null) {
  const { rows } = await db.query(
    `SELECT s.membership_id, s.status, s.review_note, s.paid_at, u.name,
            coalesce(sum(i.minutes) FILTER (WHERE i.kind IN ('base', 'overtime')), 0)::int AS minutes,
            coalesce(sum(i.minutes) FILTER (WHERE i.kind = 'overtime'), 0)::int AS overtime_minutes,
            coalesce(sum(i.amount) FILTER (WHERE i.kind = 'base'), 0)::bigint AS base,
            coalesce(sum(i.amount) FILTER (WHERE i.kind = 'overtime'), 0)::bigint AS overtime,
            coalesce(sum(i.amount) FILTER (WHERE i.kind = 'trips'), 0)::bigint AS trips,
            coalesce(sum(i.quantity) FILTER (WHERE i.kind = 'trips'), 0)::int AS trip_count,
            coalesce(sum(i.amount) FILTER (WHERE i.kind = 'bonus'), 0)::bigint AS bonuses,
            coalesce(sum(i.amount) FILTER (WHERE i.kind = 'adjustment'), 0)::bigint AS adjustments,
            coalesce(sum(i.amount) FILTER (WHERE i.kind = 'deduction'), 0)::bigint AS deductions,
            coalesce(sum(i.amount) FILTER (WHERE i.kind = 'reimbursement'), 0)::bigint AS reimbursements
       FROM payroll_statements s JOIN memberships m ON m.id = s.membership_id JOIN users u ON u.id = m.user_id
       LEFT JOIN payroll_items i ON i.run_id = s.run_id AND i.membership_id = s.membership_id
      WHERE s.run_id = $1 AND ($2::uuid IS NULL OR s.membership_id = $2)
      GROUP BY s.membership_id, s.status, s.review_note, s.paid_at, u.name ORDER BY u.name`, [runId, membershipId]);
  return rows.map((r) => {
    const gross = Number(r.base) + Number(r.overtime) + Number(r.trips) + Number(r.bonuses) + Number(r.adjustments);
    return {
      membershipId: r.membership_id, name: r.name, status: r.status, reviewNote: r.review_note, paidAt: r.paid_at,
      hours: r.minutes / 60, overtimeHours: r.overtime_minutes / 60, base: Number(r.base), overtime: Number(r.overtime),
      trips: Number(r.trips), tripCount: r.trip_count,
      bonuses: Number(r.bonuses), adjustments: Number(r.adjustments), deductions: Number(r.deductions), reimbursements: Number(r.reimbursements),
      gross, net: gross + Number(r.reimbursements) - Number(r.deductions),
    };
  });
}

const runOut = (r) => ({
  id: r.id, frequency: r.frequency, periodStart: iso(r.period_start), periodEnd: iso(r.period_end), status: r.status,
  finalizedAt: r.finalized_at, paidAt: r.paid_at, createdAt: r.created_at,
});

export async function listRuns(app, req) {
  const { rows } = await app.db.query(
    `SELECT r.*, (SELECT coalesce(sum(CASE WHEN kind = 'deduction' THEN -amount ELSE amount END), 0) FROM payroll_items i WHERE i.run_id = r.id)::bigint AS net,
            (SELECT count(*) FROM payroll_statements s WHERE s.run_id = r.id)::int AS people
       FROM payroll_runs r WHERE r.business_id = $1 ORDER BY r.period_end DESC, r.frequency LIMIT 300`, [req.member.businessId]);
  return rows.map((r) => ({ ...runOut(r), net: Number(r.net), people: r.people }));
}

export async function getRun(app, req, id) {
  const { rows: [r] } = await app.db.query('SELECT * FROM payroll_runs WHERE id = $1 AND business_id = $2', [id, req.member.businessId]);
  if (!r) throw notFound();
  const people = await summary(app.db, id);
  const { rows: items } = await app.db.query(
    `SELECT id, membership_id AS "membershipId", kind, description, minutes, amount, generated, expense_id AS "expenseId"
       FROM payroll_items WHERE run_id = $1 ORDER BY membership_id, kind`, [id]);
  const totals = people.reduce((t, p) => {
    for (const k of ['base', 'overtime', 'trips', 'tripCount', 'bonuses', 'deductions', 'reimbursements', 'gross', 'net', 'hours']) t[k] = (t[k] || 0) + p[k];
    return t;
  }, {});
  return { ...runOut(r), people, items, totals };
}

// Opens (or returns) the run for the period containing `date`, for one pay
// frequency (default: the business's). Each frequency has its own runs.
export async function createRun(app, req, { date, frequency }) {
  const biz = await business(req);
  const day = date || (await today(app.db, biz));
  const freq = frequency || biz.settings.payroll.frequency;
  const [start, end] = periodFor(day, { ...biz.settings.payroll, frequency: freq });
  const id = await transaction(app.db, async (db) => {
    const { rows: [existing] } = await db.query(
      'SELECT id FROM payroll_runs WHERE business_id = $1 AND frequency = $2 AND period_start = $3', [biz.id, freq, start]);
    if (existing) return existing.id;
    const { rows: [overlap] } = await db.query(
      'SELECT 1 FROM payroll_runs WHERE business_id = $1 AND frequency = $2 AND period_start <= $4 AND period_end >= $3', [biz.id, freq, start, end]);
    if (overlap) throw conflict('period_overlap', 'Another payroll already covers part of this period.');
    const { rows: [run] } = await db.query(
      'INSERT INTO payroll_runs (business_id, period_start, period_end, created_by, frequency) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [biz.id, start, end, req.auth.user.id, freq]);
    await calculate(db, biz, run, req.auth.user.id);
    await auditB(db, req, { action: 'payroll.run_created', targetType: 'payroll_run', targetId: run.id, after: { frequency: freq, periodStart: start, periodEnd: end } });
    return run.id;
  });
  return getRun(app, req, id);
}

async function lockRun(db, req, id, statuses = ['draft']) {
  const { rows: [r] } = await db.query('SELECT * FROM payroll_runs WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
  if (!r) throw notFound();
  if (!statuses.includes(r.status)) {
    throw conflict('run_locked', r.status === 'paid' ? 'This payroll is paid and locked. Add an adjustment to the next payroll instead.' : 'Move this payroll back to draft first.');
  }
  return r;
}

export async function recalculate(app, req, id) {
  const biz = await business(req);
  await transaction(app.db, async (db) => {
    const run = await lockRun(db, req, id);
    await calculate(db, biz, run, req.auth.user.id);
    await auditB(db, req, { action: 'payroll.recalculated', targetType: 'payroll_run', targetId: id });
  });
  return getRun(app, req, id);
}

export async function addItem(app, req, id, { membershipId, kind, amount, description }) {
  if (kind !== 'adjustment' && amount <= 0) throw badRequest('invalid_amount', 'Enter an amount above zero.');
  await transaction(app.db, async (db) => {
    await lockRun(db, req, id);
    const st = await db.query('SELECT 1 FROM payroll_statements WHERE run_id = $1 AND membership_id = $2', [id, membershipId]);
    if (!st.rows[0]) {
      const m = await db.query('SELECT 1 FROM memberships WHERE id = $1 AND business_id = $2', [membershipId, req.member.businessId]);
      if (!m.rows[0]) throw notFound();
      await db.query('INSERT INTO payroll_statements (run_id, membership_id, business_id) VALUES ($1, $2, $3)', [id, membershipId, req.member.businessId]);
    }
    const { rows: [i] } = await db.query(
      `INSERT INTO payroll_items (run_id, business_id, membership_id, kind, description, amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [id, req.member.businessId, membershipId, kind, description, amount, req.auth.user.id]);
    await auditB(db, req, { action: `payroll.${kind}_added`, targetType: 'payroll_run', targetId: id, after: { membershipId, amount, description, itemId: i.id } });
  });
  return getRun(app, req, id);
}

export async function removeItem(app, req, id, itemId) {
  await transaction(app.db, async (db) => {
    await lockRun(db, req, id);
    const { rows: [i] } = await db.query('DELETE FROM payroll_items WHERE id = $1 AND run_id = $2 AND NOT generated RETURNING *', [itemId, id]);
    if (!i) throw notFound('Only bonuses, deductions and adjustments you added can be removed.');
    await auditB(db, req, { action: 'payroll.item_removed', targetType: 'payroll_run', targetId: id, before: { kind: i.kind, amount: i.amount, description: i.description } });
  });
  return getRun(app, req, id);
}

// Fixes the amounts. Employees can now see their statement as pending.
export async function finalize(app, req, id) {
  await transaction(app.db, async (db) => {
    await lockRun(db, req, id);
    await db.query('UPDATE payroll_runs SET status = \'finalized\', finalized_at = now() WHERE id = $1', [id]);
    const people = await summary(db, id);
    for (const p of people) await notifyMember(db, req.member.businessId, p.membershipId, 'salary.pending', { runId: id, net: p.net });
    await auditB(db, req, { action: 'payroll.finalized', targetType: 'payroll_run', targetId: id, after: { people: people.length, net: people.reduce((a, p) => a + p.net, 0) } });
  });
  return getRun(app, req, id);
}

export async function reopen(app, req, id) {
  await transaction(app.db, async (db) => {
    await lockRun(db, req, id, ['finalized']);
    const paid = await db.query('SELECT 1 FROM payroll_statements WHERE run_id = $1 AND status = \'paid\'', [id]);
    if (paid.rows[0]) throw conflict('run_locked', 'Some people are already marked paid.');
    await db.query('UPDATE payroll_runs SET status = \'draft\', finalized_at = NULL WHERE id = $1', [id]);
    await auditB(db, req, { action: 'payroll.reopened', targetType: 'payroll_run', targetId: id });
  });
  return getRun(app, req, id);
}

// Flags one person's pay for review (shown to them as "Requires review").
export async function setReview(app, req, id, membershipId, { review, note }) {
  await transaction(app.db, async (db) => {
    await lockRun(db, req, id, ['draft', 'finalized']);
    const { rowCount } = await db.query(
      'UPDATE payroll_statements SET status = $3, review_note = $4 WHERE run_id = $1 AND membership_id = $2 AND status <> \'paid\'',
      [id, membershipId, review ? 'review' : 'pending', review ? note ?? null : null]);
    if (!rowCount) throw notFound();
    await auditB(db, req, { action: review ? 'payroll.flagged_for_review' : 'payroll.review_cleared', targetType: 'payroll_run', targetId: id, after: { membershipId, note } });
  });
  return getRun(app, req, id);
}

// Marks people paid. When everyone is paid the run locks.
export async function markPaid(app, req, id, { membershipIds }) {
  await transaction(app.db, async (db) => {
    await lockRun(db, req, id, ['finalized']);
    const params = [id];
    let cond = '';
    if (membershipIds?.length) { params.push(membershipIds); cond = 'AND membership_id = ANY($2::uuid[])'; }
    const { rows: blocked } = await db.query(`SELECT 1 FROM payroll_statements WHERE run_id = $1 AND status = 'review' ${cond}`, params);
    if (blocked[0]) throw conflict('needs_review', 'Clear the review flag before marking this pay as paid.');
    const { rows: paid } = await db.query(
      `UPDATE payroll_statements SET status = 'paid', paid_at = now() WHERE run_id = $1 AND status = 'pending' ${cond} RETURNING membership_id`, params);
    for (const p of paid) {
      await db.query(
        `UPDATE employee_expenses SET status = 'reimbursed', reimbursed_at = now(), updated_at = now()
          WHERE payroll_run_id = $1 AND membership_id = $2 AND status = 'approved'`, [id, p.membership_id]);
      const [s] = await summary(db, id, p.membership_id);
      await notifyMember(db, req.member.businessId, p.membership_id, 'salary.paid', { runId: id, net: s.net });
    }
    const left = await db.query('SELECT 1 FROM payroll_statements WHERE run_id = $1 AND status <> \'paid\'', [id]);
    if (!left.rows[0]) await db.query('UPDATE payroll_runs SET status = \'paid\', paid_at = now() WHERE id = $1', [id]);
    await auditB(db, req, { action: 'payroll.paid', targetType: 'payroll_run', targetId: id, after: { people: paid.length, runLocked: !left.rows[0] } });
  });
  return getRun(app, req, id);
}

// Employee pay page: the latest statement and history (spec §6). Drafts stay hidden.
export async function myPay(app, req, membershipId = req.member.id) {
  if (membershipId !== req.member.id && !can(req, 'payroll.view')) throw forbidden();
  if (membershipId === req.member.id && !can(req, 'self.pay')) throw forbidden();
  const { rows: runs } = await app.db.query(
    `SELECT r.* FROM payroll_runs r JOIN payroll_statements s ON s.run_id = r.id
      WHERE r.business_id = $1 AND s.membership_id = $2 AND r.status IN ('finalized', 'paid') ORDER BY r.period_start DESC LIMIT 60`,
    [req.member.businessId, membershipId]);
  const history = [];
  for (const r of runs) {
    const [s] = await summary(app.db, r.id, membershipId);
    history.push({ ...runOut(r), ...s, runStatus: r.status });
  }
  return { current: history[0] || null, history };
}
