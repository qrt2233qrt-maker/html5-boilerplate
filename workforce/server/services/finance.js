// Business expenses, recurring expenses, revenue, budgets and profit & loss.
// All totals are computed here from stored records, in integer minor units.
import { transaction } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { assertRange, auditB, business, history } from '../lib/context.js';

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

// ---------- dates ----------

function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
const addDays = (dateStr, n) => new Date(Date.parse(dateStr) + n * 86400000).toISOString().slice(0, 10);

// k-th occurrence of a schedule. Months are counted from the start date so
// the 31st stays on month ends instead of drifting.
export function occurrence(startOn, frequency, every, k) {
  switch (frequency) {
  case 'daily': return addDays(startOn, k * every);
  case 'weekly': return addDays(startOn, 7 * k * every);
  case 'monthly': return addMonths(startOn, k * every);
  case 'quarterly': return addMonths(startOn, 3 * k * every);
  case 'yearly': return addMonths(startOn, 12 * k * every);
  case 'custom': return addDays(startOn, k * every);
  default: throw new Error(`Unknown frequency ${frequency}`);
  }
}

export function nextAfter(r, dateStr) {
  for (let k = 0; k < 100000; k++) {
    const d = occurrence(iso(r.start_on), r.frequency, r.interval_count, k);
    if (d > dateStr) return d;
  }
  throw new Error('Recurrence did not advance');
}

export async function today(db, biz) {
  const { rows: [r] } = await db.query('SELECT (now() AT TIME ZONE $1)::date::text AS d', [biz.timezone]);
  return r.d;
}

// ---------- business expenses ----------

const expOut = (r) => ({
  id: r.id, amount: r.amount, currency: r.currency, spentOn: iso(r.spent_on), categoryId: r.category_id, categoryKey: r.category_key ?? null,
  categoryEn: r.name_en ?? null, categoryAr: r.name_ar ?? null, icon: r.icon ?? null, vendor: r.vendor, description: r.description,
  paymentMethod: r.payment_method, departmentId: r.department_id, departmentName: r.department_name ?? null, documentId: r.document_id,
  notes: r.notes, recurringId: r.recurring_id, source: r.source, createdAt: r.created_at, archivedAt: r.archived_at,
});

const EXP_SELECT = `SELECT x.*, c.key AS category_key, c.name_en, c.name_ar, c.icon, d.name AS department_name
  FROM business_expenses x JOIN expense_categories c ON c.id = x.category_id LEFT JOIN departments d ON d.id = x.department_id`;

async function checkCategory(db, req, table, id) {
  const { rows: [c] } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND business_id = $2 AND archived_at IS NULL`, [id, req.member.businessId]);
  if (!c) throw badRequest('invalid_category', 'Choose a category.');
}

async function checkDoc(db, req, documentId) {
  if (!documentId) return;
  const { rows: [d] } = await db.query('SELECT 1 FROM documents WHERE id = $1 AND business_id = $2 AND archived_at IS NULL', [documentId, req.member.businessId]);
  if (!d) throw badRequest('invalid_document', 'Upload the document again.');
}

export async function listBusinessExpenses(app, req, { from, to, categoryId, q, departmentId, includeArchived, limit = 100, offset = 0 }) {
  assertRange(from, to);
  const params = [req.member.businessId, from, to];
  const where = ['x.business_id = $1', 'x.spent_on BETWEEN $2 AND $3'];
  if (!includeArchived) where.push('x.archived_at IS NULL');
  if (categoryId) { params.push(categoryId); where.push(`x.category_id = $${params.length}`); }
  if (departmentId) { params.push(departmentId); where.push(`x.department_id = $${params.length}`); }
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`);
    where.push(`(x.vendor ILIKE $${params.length} OR x.description ILIKE $${params.length} OR x.notes ILIKE $${params.length})`);
  }
  const { rows: [tot] } = await app.db.query(
    `SELECT count(*)::int AS count, coalesce(sum(x.amount), 0)::bigint AS total FROM business_expenses x WHERE ${where.join(' AND ')}`, params);
  params.push(Math.min(limit, 500), offset);
  const { rows } = await app.db.query(
    `${EXP_SELECT} WHERE ${where.join(' AND ')} ORDER BY x.spent_on DESC, x.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { items: rows.map(expOut), count: tot.count, total: Number(tot.total) };
}

export async function createBusinessExpense(app, req, input) {
  const biz = await business(req);
  return transaction(app.db, async (db) => {
    await checkCategory(db, req, 'expense_categories', input.categoryId);
    await checkDoc(db, req, input.documentId);
    const { rows: [x] } = await db.query(
      `INSERT INTO business_expenses (business_id, amount, currency, spent_on, category_id, vendor, description, payment_method,
         department_id, document_id, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [biz.id, input.amount, biz.currency, input.spentOn, input.categoryId, input.vendor ?? null, input.description ?? null,
        input.paymentMethod ?? null, input.departmentId ?? null, input.documentId ?? null, input.notes ?? null, req.auth.user.id]);
    await history(db, req, 'business_expense', x.id, 'created', null, expOut(x));
    await auditB(db, req, { action: 'business_expense.created', targetType: 'business_expense', targetId: x.id, after: { amount: x.amount, spentOn: input.spentOn } });
    if (input.amount >= biz.settings.alerts.largeExpense) {
      const { notifyApprovers } = await import('../lib/notify.js');
      await notifyApprovers(db, biz.id, 'finance.view', null, 'finance.large_expense', { expenseId: x.id, amount: x.amount });
    }
    return expOut(x);
  });
}

// Changes keep the previous version; the reason is required.
export async function updateBusinessExpense(app, req, id, input) {
  return transaction(app.db, async (db) => {
    const { rows: [x] } = await db.query('SELECT * FROM business_expenses WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
    if (!x) throw notFound();
    if (x.archived_at) throw conflict('archived', 'Restore this expense before changing it.');
    if (input.categoryId) await checkCategory(db, req, 'expense_categories', input.categoryId);
    await checkDoc(db, req, input.documentId);
    const { rows: [u] } = await db.query(
      `UPDATE business_expenses SET amount = coalesce($2, amount), spent_on = coalesce($3, spent_on), category_id = coalesce($4, category_id),
         vendor = coalesce($5, vendor), description = coalesce($6, description), payment_method = coalesce($7, payment_method),
         department_id = CASE WHEN $8::boolean THEN $9::uuid ELSE department_id END, document_id = coalesce($10, document_id),
         notes = coalesce($11, notes), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, input.amount ?? null, input.spentOn ?? null, input.categoryId ?? null, input.vendor ?? null, input.description ?? null,
        input.paymentMethod ?? null, input.departmentId !== undefined, input.departmentId ?? null, input.documentId ?? null, input.notes ?? null]);
    await history(db, req, 'business_expense', id, 'updated', expOut(x), expOut(u), input.reason);
    await auditB(db, req, { action: 'business_expense.updated', targetType: 'business_expense', targetId: id, before: { amount: x.amount, spentOn: iso(x.spent_on) }, after: { amount: u.amount, spentOn: iso(u.spent_on), reason: input.reason } });
    return expOut(u);
  });
}

// Archive instead of delete (spec §21); restoring is possible.
export async function archiveBusinessExpense(app, req, id, { archived, reason }) {
  return transaction(app.db, async (db) => {
    const { rows: [x] } = await db.query('SELECT * FROM business_expenses WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
    if (!x) throw notFound();
    await db.query(`UPDATE business_expenses SET archived_at = ${archived ? 'now()' : 'NULL'}, updated_at = now() WHERE id = $1`, [id]);
    await history(db, req, 'business_expense', id, archived ? 'archived' : 'restored', expOut(x), null, reason);
    await auditB(db, req, { action: archived ? 'business_expense.archived' : 'business_expense.restored', targetType: 'business_expense', targetId: id, before: { amount: x.amount }, after: { reason } });
  });
}

export async function recordHistory(app, req, entityType, id) {
  const { rows } = await app.db.query(
    `SELECT h.change_type AS "changeType", h.before, h.after, h.reason, h.created_at AS "createdAt", u.name AS "changedBy"
       FROM record_history h LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.business_id = $1 AND h.entity_type = $2 AND h.entity_id = $3 ORDER BY h.id`, [req.member.businessId, entityType, id]);
  return rows;
}

// ---------- recurring expenses ----------

const recOut = (r) => ({
  id: r.id, amount: r.amount, categoryId: r.category_id, categoryEn: r.name_en ?? null, categoryAr: r.name_ar ?? null, icon: r.icon ?? null,
  vendor: r.vendor, description: r.description, paymentMethod: r.payment_method, departmentId: r.department_id,
  frequency: r.frequency, intervalCount: r.interval_count, startOn: iso(r.start_on), endOn: r.end_on ? iso(r.end_on) : null,
  nextOn: iso(r.next_on), active: r.active,
});

export async function listRecurring(app, req) {
  const { rows } = await app.db.query(
    `SELECT r.*, c.name_en, c.name_ar, c.icon FROM recurring_expenses r JOIN expense_categories c ON c.id = r.category_id
      WHERE r.business_id = $1 ORDER BY r.active DESC, r.next_on`, [req.member.businessId]);
  return rows.map(recOut);
}

export async function saveRecurring(app, req, id, input) {
  const biz = await business(req);
  return transaction(app.db, async (db) => {
    if (input.categoryId) await checkCategory(db, req, 'expense_categories', input.categoryId);
    let row;
    if (id) {
      const { rows: [r] } = await db.query('SELECT * FROM recurring_expenses WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, biz.id]);
      if (!r) throw notFound();
      ({ rows: [row] } = await db.query(
        `UPDATE recurring_expenses SET amount = coalesce($2, amount), category_id = coalesce($3, category_id), vendor = coalesce($4, vendor),
           description = coalesce($5, description), payment_method = coalesce($6, payment_method), end_on = CASE WHEN $7::boolean THEN $8::date ELSE end_on END,
           active = coalesce($9, active), updated_at = now() WHERE id = $1 RETURNING *`,
        [id, input.amount ?? null, input.categoryId ?? null, input.vendor ?? null, input.description ?? null, input.paymentMethod ?? null,
          input.endOn !== undefined, input.endOn ?? null, input.active ?? null]));
      await history(db, req, 'recurring_expense', id, 'updated', recOut(r), recOut(row), input.reason);
    } else {
      if (input.frequency === 'custom' && !input.intervalCount) throw badRequest('interval_required', 'Choose how many days between payments.');
      ({ rows: [row] } = await db.query(
        `INSERT INTO recurring_expenses (business_id, amount, category_id, vendor, description, payment_method, department_id, frequency,
           interval_count, start_on, end_on, next_on, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $12) RETURNING *`,
        [biz.id, input.amount, input.categoryId, input.vendor ?? null, input.description, input.paymentMethod ?? null, input.departmentId ?? null,
          input.frequency, input.intervalCount ?? 1, input.startOn, input.endOn ?? null, req.auth.user.id]));
      await history(db, req, 'recurring_expense', row.id, 'created', null, recOut(row));
    }
    await auditB(db, req, { action: id ? 'recurring_expense.updated' : 'recurring_expense.created', targetType: 'recurring_expense', targetId: row.id, after: { amount: row.amount, frequency: row.frequency } });
    return recOut(row);
  }).then(async (r) => {
    await generateDue(app.db, biz.id);
    return (await listRecurring(app, req)).find((x) => x.id === r.id);
  });
}

// Records every due occurrence up to today. Safe to run repeatedly: the
// unique (recurring_id, spent_on) index stops duplicates.
export async function generateDue(db, businessId = null) {
  const { rows } = await db.query(
    `SELECT r.*, b.currency, b.timezone, (now() AT TIME ZONE b.timezone)::date::text AS today
       FROM recurring_expenses r JOIN businesses b ON b.id = r.business_id
      WHERE r.active AND r.next_on <= (now() AT TIME ZONE b.timezone)::date AND ($1::uuid IS NULL OR r.business_id = $1)`, [businessId]);
  let created = 0;
  for (const r of rows) {
    let next = iso(r.next_on);
    let guard = 0;
    while (next <= r.today && (!r.end_on || next <= iso(r.end_on)) && guard++ < 1000) {
      const ins = await db.query(
        `INSERT INTO business_expenses (business_id, amount, currency, spent_on, category_id, vendor, description, payment_method,
           department_id, recurring_id, source, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'recurring', $11)
         ON CONFLICT (recurring_id, spent_on) WHERE recurring_id IS NOT NULL DO NOTHING RETURNING id`,
        [r.business_id, r.amount, r.currency, next, r.category_id, r.vendor, r.description, r.payment_method, r.department_id, r.id, r.created_by]);
      created += ins.rowCount;
      next = nextAfter(r, next);
    }
    const ended = r.end_on && next > iso(r.end_on);
    await db.query('UPDATE recurring_expenses SET next_on = $2, active = $3, updated_at = now() WHERE id = $1', [r.id, next, !ended]);
  }
  return created;
}

// Upcoming payments over the next `days` days (spec §9).
export async function upcomingRecurring(app, req, days = 90) {
  const biz = await business(req);
  const start = await today(app.db, biz);
  const end = addDays(start, days);
  const { rows } = await app.db.query(
    `SELECT r.*, c.name_en, c.name_ar, c.icon FROM recurring_expenses r JOIN expense_categories c ON c.id = r.category_id
      WHERE r.business_id = $1 AND r.active`, [biz.id]);
  const items = [];
  for (const r of rows) {
    let d = iso(r.next_on);
    while (d <= end && (!r.end_on || d <= iso(r.end_on))) {
      if (d >= start) items.push({ recurringId: r.id, date: d, amount: r.amount, description: r.description, vendor: r.vendor, categoryEn: r.name_en, categoryAr: r.name_ar, icon: r.icon });
      d = nextAfter(r, d);
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  const byMonth = {};
  for (const i of items) byMonth[i.date.slice(0, 7)] = (byMonth[i.date.slice(0, 7)] || 0) + i.amount;
  return { from: start, to: end, items, total: items.reduce((a, i) => a + i.amount, 0), byMonth };
}

// ---------- revenue ----------

const revOut = (r) => ({
  id: r.id, amount: r.amount, currency: r.currency, receivedOn: iso(r.received_on), categoryId: r.category_id, categoryKey: r.category_key ?? null,
  categoryEn: r.name_en ?? null, categoryAr: r.name_ar ?? null, kind: r.kind ?? null, description: r.description,
  paymentMethod: r.payment_method, source: r.source, notes: r.notes, createdAt: r.created_at, archivedAt: r.archived_at,
});

export async function listRevenue(app, req, { from, to, categoryId, q, includeArchived, limit = 100, offset = 0 }) {
  assertRange(from, to);
  const params = [req.member.businessId, from, to];
  const where = ['v.business_id = $1', 'v.received_on BETWEEN $2 AND $3'];
  if (!includeArchived) where.push('v.archived_at IS NULL');
  if (categoryId) { params.push(categoryId); where.push(`v.category_id = $${params.length}`); }
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`);
    where.push(`(v.description ILIKE $${params.length} OR v.source ILIKE $${params.length} OR v.notes ILIKE $${params.length})`);
  }
  const { rows: [tot] } = await app.db.query(
    `SELECT count(*)::int AS count, coalesce(sum(CASE WHEN c.kind = 'refund' THEN -v.amount ELSE v.amount END), 0)::bigint AS total
       FROM revenues v JOIN revenue_categories c ON c.id = v.category_id WHERE ${where.join(' AND ')}`, params);
  params.push(Math.min(limit, 500), offset);
  const { rows } = await app.db.query(
    `SELECT v.*, c.key AS category_key, c.name_en, c.name_ar, c.kind FROM revenues v JOIN revenue_categories c ON c.id = v.category_id
      WHERE ${where.join(' AND ')} ORDER BY v.received_on DESC, v.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { items: rows.map(revOut), count: tot.count, total: Number(tot.total) };
}

async function checkRevenueAmount(db, categoryId, amount) {
  const { rows: [c] } = await db.query('SELECT kind FROM revenue_categories WHERE id = $1', [categoryId]);
  if (c.kind !== 'adjustment' && amount < 0) throw badRequest('invalid_amount', 'Use a positive amount. Refunds are subtracted automatically.');
}

export async function createRevenue(app, req, input) {
  const biz = await business(req);
  return transaction(app.db, async (db) => {
    await checkCategory(db, req, 'revenue_categories', input.categoryId);
    await checkRevenueAmount(db, input.categoryId, input.amount);
    const { rows: [v] } = await db.query(
      `INSERT INTO revenues (business_id, amount, currency, received_on, category_id, description, payment_method, source, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [biz.id, input.amount, biz.currency, input.receivedOn, input.categoryId, input.description ?? null, input.paymentMethod ?? null,
        input.source ?? null, input.notes ?? null, req.auth.user.id]);
    await history(db, req, 'revenue', v.id, 'created', null, revOut(v));
    await auditB(db, req, { action: 'revenue.created', targetType: 'revenue', targetId: v.id, after: { amount: v.amount, receivedOn: input.receivedOn } });
    return revOut(v);
  });
}

export async function updateRevenue(app, req, id, input) {
  return transaction(app.db, async (db) => {
    const { rows: [v] } = await db.query('SELECT * FROM revenues WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
    if (!v) throw notFound();
    if (v.archived_at) throw conflict('archived', 'Restore this record before changing it.');
    const categoryId = input.categoryId ?? v.category_id;
    if (input.categoryId) await checkCategory(db, req, 'revenue_categories', input.categoryId);
    await checkRevenueAmount(db, categoryId, input.amount ?? v.amount);
    const { rows: [u] } = await db.query(
      `UPDATE revenues SET amount = coalesce($2, amount), received_on = coalesce($3, received_on), category_id = $4,
         description = coalesce($5, description), payment_method = coalesce($6, payment_method), source = coalesce($7, source),
         notes = coalesce($8, notes), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, input.amount ?? null, input.receivedOn ?? null, categoryId, input.description ?? null, input.paymentMethod ?? null, input.source ?? null, input.notes ?? null]);
    await history(db, req, 'revenue', id, 'updated', revOut(v), revOut(u), input.reason);
    await auditB(db, req, { action: 'revenue.updated', targetType: 'revenue', targetId: id, before: { amount: v.amount }, after: { amount: u.amount, reason: input.reason } });
    return revOut(u);
  });
}

export async function archiveRevenue(app, req, id, { archived, reason }) {
  return transaction(app.db, async (db) => {
    const { rows: [v] } = await db.query('SELECT * FROM revenues WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
    if (!v) throw notFound();
    await db.query(`UPDATE revenues SET archived_at = ${archived ? 'now()' : 'NULL'}, updated_at = now() WHERE id = $1`, [id]);
    await history(db, req, 'revenue', id, archived ? 'archived' : 'restored', revOut(v), null, reason);
    await auditB(db, req, { action: archived ? 'revenue.archived' : 'revenue.restored', targetType: 'revenue', targetId: id, after: { reason } });
  });
}

// ---------- profit & loss ----------

/**
 * Revenue - (business expenses + approved employee expenses + payroll) for
 * an inclusive date range. Payroll counts runs that are finalized or paid,
 * by the end of their period.
 */
export async function profitAndLoss(db, businessId, from, to) {
  const { rows: rev } = await db.query(
    `SELECT c.id, c.key, c.name_en, c.name_ar, c.kind, count(v.id)::int AS count,
            coalesce(sum(CASE WHEN c.kind = 'refund' THEN -v.amount ELSE v.amount END), 0)::bigint AS amount
       FROM revenues v JOIN revenue_categories c ON c.id = v.category_id
      WHERE v.business_id = $1 AND v.archived_at IS NULL AND v.received_on BETWEEN $2 AND $3
      GROUP BY c.id ORDER BY amount DESC`, [businessId, from, to]);
  const { rows: exp } = await db.query(
    `SELECT c.id, c.key, c.name_en, c.name_ar, c.kind, c.icon, count(x.id)::int AS count, sum(x.amount)::bigint AS amount
       FROM business_expenses x JOIN expense_categories c ON c.id = x.category_id
      WHERE x.business_id = $1 AND x.archived_at IS NULL AND x.spent_on BETWEEN $2 AND $3
      GROUP BY c.id`, [businessId, from, to]);
  const { rows: [emp] } = await db.query(
    `SELECT count(*)::int AS count, coalesce(sum(amount), 0)::bigint AS amount FROM employee_expenses
      WHERE business_id = $1 AND status IN ('approved', 'reimbursed') AND spent_on BETWEEN $2 AND $3`, [businessId, from, to]);
  const { rows: [pay] } = await db.query(
    `SELECT coalesce(sum(i.amount) FILTER (WHERE i.kind IN ('base', 'bonus', 'adjustment', 'overtime')), 0)::bigint AS gross,
            coalesce(sum(i.amount) FILTER (WHERE i.kind = 'overtime'), 0)::bigint AS overtime,
            coalesce(sum(i.amount) FILTER (WHERE i.kind = 'bonus'), 0)::bigint AS bonuses,
            coalesce(sum(i.amount) FILTER (WHERE i.kind = 'deduction'), 0)::bigint AS deductions,
            count(DISTINCT i.membership_id)::int AS employees, count(DISTINCT r.id)::int AS runs
       FROM payroll_runs r JOIN payroll_items i ON i.run_id = r.id
      WHERE r.business_id = $1 AND r.status IN ('finalized', 'paid') AND r.period_end BETWEEN $2 AND $3`, [businessId, from, to]);

  const categories = exp.map((c) => ({ key: c.key, id: c.id, nameEn: c.name_en, nameAr: c.name_ar, kind: c.kind, icon: c.icon, amount: Number(c.amount), count: c.count }));
  if (Number(pay.gross)) categories.push({ key: 'payroll', id: null, nameEn: 'Payroll', nameAr: 'الرواتب', kind: 'payroll', icon: '👥', amount: Number(pay.gross), count: pay.runs });
  if (Number(emp.amount)) categories.push({ key: 'employee_reimbursements', id: null, nameEn: 'Employee reimbursements', nameAr: 'تعويضات الموظفين', kind: 'operating', icon: '🧾', amount: Number(emp.amount), count: emp.count });
  categories.sort((a, b) => b.amount - a.amount);

  const revenue = rev.reduce((a, r) => a + Number(r.amount), 0);
  const expenses = categories.reduce((a, c) => a + c.amount, 0);
  // Labour = payroll plus anything recorded directly under the salaries category.
  const laborCost = Number(pay.gross) + categories.filter((c) => c.kind === 'payroll' && c.key !== 'payroll').reduce((a, c) => a + c.amount, 0);
  const profit = revenue - expenses;
  return {
    from, to,
    revenue: { total: revenue, byCategory: rev.map((r) => ({ key: r.key, id: r.id, nameEn: r.name_en, nameAr: r.name_ar, kind: r.kind, amount: Number(r.amount), count: r.count })) },
    expenses: { total: expenses, byCategory: categories.map((c) => ({ ...c, share: expenses ? c.amount / expenses : 0 })) },
    payroll: { gross: Number(pay.gross), overtime: Number(pay.overtime), bonuses: Number(pay.bonuses), deductions: Number(pay.deductions), employees: pay.employees, reimbursements: Number(emp.amount) },
    laborCost,
    profit,
    margin: revenue ? profit / revenue : null,
  };
}

// ---------- budgets ----------

export function periodBounds(period, dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  if (period === 'monthly') return [`${dateStr.slice(0, 7)}-01`, addDays(addMonths(`${dateStr.slice(0, 7)}-01`, 1), -1)];
  if (period === 'quarterly') {
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    const start = `${y}-${String(qm).padStart(2, '0')}-01`;
    return [start, addDays(addMonths(start, 3), -1)];
  }
  return [`${y}-01-01`, `${y}-12-31`];
}

export async function listBudgets(app, req, date) {
  const biz = await business(req);
  const day = date || (await today(app.db, biz));
  const { rows } = await app.db.query(
    `SELECT b.*, c.key AS category_key, c.name_en, c.name_ar, c.icon FROM budgets b LEFT JOIN expense_categories c ON c.id = b.category_id
      WHERE b.business_id = $1 AND b.active ORDER BY b.scope, c.name_en`, [biz.id]);
  const cache = new Map();
  const out = [];
  for (const b of rows) {
    const [from, to] = periodBounds(b.period, day);
    const key = `${from}|${to}`;
    if (!cache.has(key)) cache.set(key, await profitAndLoss(app.db, biz.id, from, to));
    const pnl = cache.get(key);
    let actual;
    if (b.scope === 'total') actual = pnl.expenses.total;
    else if (b.scope === 'payroll') actual = pnl.laborCost;
    else {
      actual = pnl.expenses.byCategory.filter((c) => c.id === b.category_id).reduce((a, c) => a + c.amount, 0);
      // Approved employee claims count against their own category's budget.
      const { rows: [e] } = await app.db.query(
        `SELECT coalesce(sum(amount), 0)::bigint AS n FROM employee_expenses WHERE business_id = $1 AND category_id = $2
           AND status IN ('approved', 'reimbursed') AND spent_on BETWEEN $3 AND $4`, [biz.id, b.category_id, from, to]);
      actual += Number(e.n);
    }
    out.push({
      id: b.id, scope: b.scope, categoryId: b.category_id, categoryEn: b.name_en, categoryAr: b.name_ar, icon: b.icon, period: b.period,
      amount: b.amount, from, to, actual, remaining: b.amount - actual, used: actual / b.amount, over: actual > b.amount,
    });
  }
  return out;
}

export async function saveBudget(app, req, id, input) {
  const db = app.db;
  let row;
  try {
    if (id) {
      ({ rows: [row] } = await db.query(
        'UPDATE budgets SET amount = coalesce($3, amount), active = coalesce($4, active), updated_at = now() WHERE id = $1 AND business_id = $2 RETURNING *',
        [id, req.member.businessId, input.amount ?? null, input.active ?? null]));
      if (!row) throw notFound();
    } else {
      if ((input.scope === 'category') !== !!input.categoryId) throw badRequest('invalid_budget', 'Category budgets need a category.');
      if (input.categoryId) await checkCategory(db, req, 'expense_categories', input.categoryId);
      ({ rows: [row] } = await db.query(
        'INSERT INTO budgets (business_id, scope, category_id, period, amount) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [req.member.businessId, input.scope, input.categoryId ?? null, input.period || 'monthly', input.amount]));
    }
  } catch (err) {
    if (err.code === '23505') throw conflict('duplicate_budget', 'There is already a budget for this.');
    throw err;
  }
  await auditB(db, req, { action: id ? 'budget.updated' : 'budget.created', targetType: 'budget', targetId: row.id, after: { scope: row.scope, amount: row.amount, active: row.active } });
  return { id: row.id };
}
