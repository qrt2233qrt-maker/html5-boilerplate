// Reports (spec §27): on-screen JSON, CSV and Excel exports built by a
// background job. Money is exported in whole currency units.
import { forbidden, notFound } from '../lib/errors.js';
import { assertRange, auditB, business, managedScope, scopeSql } from '../lib/context.js';
import { toCsv, toXlsx } from '../lib/export.js';
import { rateLimit } from '../lib/rate-limit.js';
import { loadPermissions } from '../auth/permissions.js';
import { listBudgets, profitAndLoss } from './finance.js';
import { saveGenerated } from './documents.js';

const L = (en, ar) => ({ en, ar });

export const REPORTS = {
  pnl: { perm: ['reports.financial', 'finance.view'], title: L('Profit and loss', 'الأرباح والخسائر') },
  performance: { perm: ['reports.financial', 'finance.view'], title: L('Business performance', 'أداء النشاط') },
  revenue: { perm: ['reports.financial', 'revenue.view'], title: L('Revenue', 'الإيرادات') },
  expenses: { perm: ['reports.financial', 'business_expenses.view'], title: L('Expenses', 'المصاريف') },
  employee_expenses: { perm: ['reports.financial', 'employee_expenses.review'], title: L('Employee expenses', 'مصاريف الموظفين') },
  payroll: { perm: ['reports.financial', 'payroll.view'], title: L('Payroll', 'الرواتب') },
  budgets: { perm: ['reports.financial', 'finance.view'], title: L('Budgets', 'الميزانيات') },
  hours: { perm: ['reports.operational'], title: L('Employee hours', 'ساعات الموظفين') },
  attendance: { perm: ['reports.operational', 'attendance.view'], title: L('Attendance', 'الحضور') },
  shifts: { perm: ['reports.operational', 'schedules.view'], title: L('Shifts', 'المناوبات') },
};

export function availableReports(req) {
  return Object.entries(REPORTS).filter(([, r]) => r.perm.every((p) => req.member.permissions.has(p))).map(([key, r]) => ({ key, title: r.title }));
}

const col = (key, en, ar, kind = 'text') => ({ key, label: { en, ar }, kind });
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

async function build(app, req, type, { from, to, departmentId, membershipId, categoryId }) {
  assertRange(from, to);
  const biz = await business(req);
  const db = app.db;
  const tz = biz.timezone;
  const scope = await managedScope(req);
  const peopleFilter = (params, alias = 'm') => {
    const parts = [scopeSql(scope, params, alias)];
    if (departmentId) { params.push(departmentId); parts.push(`${alias}.department_id = $${params.length}`); }
    if (membershipId) { params.push(membershipId); parts.push(`${alias}.id = $${params.length}`); }
    return parts.join(' AND ');
  };
  switch (type) {
  case 'pnl': {
    const p = await profitAndLoss(db, biz.id, from, to);
    const rows = [
      ...p.revenue.byCategory.map((c) => ({ section: 'Revenue', category: c.nameEn, categoryAr: c.nameAr, count: c.count, amount: c.amount })),
      { section: 'Revenue', category: 'Total revenue', categoryAr: 'إجمالي الإيرادات', amount: p.revenue.total },
      ...p.expenses.byCategory.map((c) => ({ section: 'Expenses', category: c.nameEn, categoryAr: c.nameAr, count: c.count, amount: c.amount, share: Math.round(c.share * 1000) / 10 })),
      { section: 'Expenses', category: 'Total expenses', categoryAr: 'إجمالي المصاريف', amount: p.expenses.total },
      { section: 'Result', category: 'Operating profit', categoryAr: 'الربح التشغيلي', amount: p.profit },
      { section: 'Result', category: 'Labour cost', categoryAr: 'تكلفة العمالة', amount: p.laborCost },
      { section: 'Result', category: 'Profit margin %', categoryAr: 'هامش الربح %', number: p.margin === null ? null : Math.round(p.margin * 1000) / 10 },
    ];
    return { columns: [col('section', 'Section', 'القسم'), col('category', 'Line', 'البند'), col('categoryAr', 'Line (Arabic)', 'البند بالعربية'), col('count', 'Transactions', 'العمليات', 'number'), col('amount', 'Amount', 'المبلغ', 'money'), col('share', 'Share %', 'النسبة %', 'number'), col('number', 'Value', 'القيمة', 'number')], rows };
  }
  case 'performance': {
    const { rows } = await db.query(
      'SELECT to_char(m, \'YYYY-MM\') AS month FROM generate_series(date_trunc(\'month\', $1::date), date_trunc(\'month\', $2::date), interval \'1 month\') m', [from, to]);
    const out = [];
    for (const r of rows) {
      const start = `${r.month}-01`;
      const end = new Date(Date.UTC(Number(r.month.slice(0, 4)), Number(r.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const p = await profitAndLoss(db, biz.id, start < from ? from : start, end > to ? to : end);
      out.push({ month: r.month, revenue: p.revenue.total, expenses: p.expenses.total, payroll: p.laborCost, profit: p.profit, margin: p.margin === null ? null : Math.round(p.margin * 1000) / 10 });
    }
    return { columns: [col('month', 'Month', 'الشهر'), col('revenue', 'Revenue', 'الإيرادات', 'money'), col('expenses', 'Expenses', 'المصاريف', 'money'), col('payroll', 'Labour cost', 'تكلفة العمالة', 'money'), col('profit', 'Profit', 'الربح', 'money'), col('margin', 'Margin %', 'الهامش %', 'number')], rows: out };
  }
  case 'revenue': {
    const params = [biz.id, from, to];
    let cond = '';
    if (categoryId) { params.push(categoryId); cond = `AND v.category_id = $${params.length}`; }
    const { rows } = await db.query(
      `SELECT v.received_on, c.name_en, c.name_ar, c.kind, CASE WHEN c.kind = 'refund' THEN -v.amount ELSE v.amount END AS amount,
              v.description, v.source, v.payment_method FROM revenues v JOIN revenue_categories c ON c.id = v.category_id
        WHERE v.business_id = $1 AND v.archived_at IS NULL AND v.received_on BETWEEN $2 AND $3 ${cond} ORDER BY v.received_on`, params);
    return {
      columns: [col('date', 'Date', 'التاريخ', 'date'), col('category', 'Category', 'الفئة'), col('amount', 'Amount', 'المبلغ', 'money'), col('description', 'Description', 'الوصف'), col('source', 'Customer / source', 'العميل / المصدر'), col('method', 'Payment method', 'طريقة الدفع')],
      rows: rows.map((r) => ({ date: iso(r.received_on), category: `${r.name_en} / ${r.name_ar}`, amount: Number(r.amount), description: r.description, source: r.source, method: r.payment_method })),
    };
  }
  case 'expenses': {
    const params = [biz.id, from, to];
    let cond = '';
    if (categoryId) { params.push(categoryId); cond = `AND category_id = $${params.length}`; }
    if (departmentId) { params.push(departmentId); cond += ` AND department_id = $${params.length}`; }
    const { rows } = await db.query(
      `SELECT x.day, c.name_en, c.name_ar, x.amount, x.vendor, x.description, x.source, x.method FROM (
         SELECT spent_on AS day, category_id, amount, vendor, description, 'Business' AS source, payment_method AS method, department_id
           FROM business_expenses WHERE business_id = $1 AND archived_at IS NULL AND spent_on BETWEEN $2 AND $3
         UNION ALL
         SELECT e.spent_on, e.category_id, e.amount, u.name, e.description, 'Employee claim', NULL, m.department_id
           FROM employee_expenses e JOIN memberships m ON m.id = e.membership_id JOIN users u ON u.id = m.user_id
          WHERE e.business_id = $1 AND e.status IN ('approved', 'reimbursed') AND e.spent_on BETWEEN $2 AND $3
       ) x JOIN expense_categories c ON c.id = x.category_id WHERE TRUE ${cond} ORDER BY x.day`, params);
    return {
      columns: [col('date', 'Date', 'التاريخ', 'date'), col('category', 'Category', 'الفئة'), col('amount', 'Amount', 'المبلغ', 'money'), col('vendor', 'Vendor / person', 'الجهة / الشخص'), col('description', 'Description', 'الوصف'), col('source', 'Type', 'النوع'), col('method', 'Payment method', 'طريقة الدفع')],
      rows: rows.map((r) => ({ date: iso(r.day), category: `${r.name_en} / ${r.name_ar}`, amount: Number(r.amount), vendor: r.vendor, description: r.description, source: r.source, method: r.method })),
    };
  }
  case 'employee_expenses': {
    const params = [biz.id, from, to];
    const f = peopleFilter(params);
    const { rows } = await db.query(
      `SELECT e.spent_on, u.name, c.name_en, c.name_ar, e.amount, e.description, e.business_purpose, e.status, e.reimbursed_at
         FROM employee_expenses e JOIN memberships m ON m.id = e.membership_id JOIN users u ON u.id = m.user_id
         JOIN expense_categories c ON c.id = e.category_id
        WHERE e.business_id = $1 AND e.status <> 'draft' AND e.spent_on BETWEEN $2 AND $3 AND ${f} ORDER BY e.spent_on`, params);
    return {
      columns: [col('date', 'Date', 'التاريخ', 'date'), col('employee', 'Employee', 'الموظف'), col('category', 'Category', 'الفئة'), col('amount', 'Amount', 'المبلغ', 'money'), col('description', 'Description', 'الوصف'), col('purpose', 'Business purpose', 'الغرض'), col('status', 'Status', 'الحالة')],
      rows: rows.map((r) => ({ date: iso(r.spent_on), employee: r.name, category: `${r.name_en} / ${r.name_ar}`, amount: Number(r.amount), description: r.description, purpose: r.business_purpose, status: r.status })),
    };
  }
  case 'payroll': {
    const params = [biz.id, from, to];
    const f = peopleFilter(params);
    const { rows } = await db.query(
      `SELECT r.period_start, r.period_end, u.name, s.status,
              coalesce(sum(i.minutes) FILTER (WHERE i.kind IN ('base', 'overtime')), 0) / 60.0 AS hours,
              coalesce(sum(i.amount) FILTER (WHERE i.kind IN ('base', 'overtime', 'trips', 'bonus', 'adjustment')), 0)::bigint AS gross,
              coalesce(sum(i.amount) FILTER (WHERE i.kind = 'overtime'), 0)::bigint AS overtime,
              coalesce(sum(i.amount) FILTER (WHERE i.kind = 'reimbursement'), 0)::bigint AS reimbursements,
              coalesce(sum(i.amount) FILTER (WHERE i.kind = 'deduction'), 0)::bigint AS deductions
         FROM payroll_runs r JOIN payroll_statements s ON s.run_id = r.id JOIN memberships m ON m.id = s.membership_id JOIN users u ON u.id = m.user_id
         LEFT JOIN payroll_items i ON i.run_id = r.id AND i.membership_id = s.membership_id
        WHERE r.business_id = $1 AND r.status IN ('finalized', 'paid') AND r.period_end BETWEEN $2 AND $3 AND ${f}
        GROUP BY r.id, u.name, s.status ORDER BY r.period_start, u.name`, params);
    return {
      columns: [col('period', 'Period', 'الفترة'), col('employee', 'Employee', 'الموظف'), col('hours', 'Hours', 'الساعات', 'number'), col('gross', 'Gross', 'الإجمالي', 'money'), col('overtime', 'Overtime', 'العمل الإضافي', 'money'), col('reimbursements', 'Expenses', 'المصاريف', 'money'), col('deductions', 'Deductions', 'الاستقطاعات', 'money'), col('net', 'Net', 'الصافي', 'money'), col('status', 'Status', 'الحالة')],
      rows: rows.map((r) => ({
        period: `${iso(r.period_start)} – ${iso(r.period_end)}`, employee: r.name, hours: Math.round(Number(r.hours) * 100) / 100, gross: Number(r.gross),
        overtime: Number(r.overtime), reimbursements: Number(r.reimbursements), deductions: Number(r.deductions),
        net: Number(r.gross) + Number(r.reimbursements) - Number(r.deductions), status: r.status,
      })),
    };
  }
  case 'budgets': {
    const list = await listBudgets(app, req, to);
    return {
      columns: [col('budget', 'Budget', 'الميزانية'), col('period', 'Period', 'الفترة'), col('amount', 'Budget', 'المبلغ', 'money'), col('actual', 'Actual', 'الفعلي', 'money'), col('remaining', 'Remaining', 'المتبقي', 'money'), col('used', 'Used %', 'المستخدم %', 'number')],
      rows: list.map((b) => ({ budget: b.scope === 'category' ? `${b.categoryEn} / ${b.categoryAr}` : b.scope, period: `${b.from} – ${b.to}`, amount: b.amount, actual: b.actual, remaining: b.remaining, used: Math.round(b.used * 1000) / 10 })),
    };
  }
  case 'hours': {
    const params = [biz.id, from, to, tz];
    const f = peopleFilter(params);
    const { rows } = await db.query(
      `SELECT u.name, d.name AS department,
              (SELECT coalesce(sum(extract(epoch FROM (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0), 0) FROM shifts s
                WHERE s.membership_id = m.id AND s.status <> 'cancelled' AND s.starts_at >= ($2::date)::timestamp AT TIME ZONE $4
                  AND s.starts_at < (($3::date) + 1)::timestamp AT TIME ZONE $4) AS scheduled,
              (SELECT coalesce(sum(extract(epoch FROM (a.clock_out - a.clock_in)) / 3600 - a.break_minutes / 60.0), 0) FROM attendance a
                WHERE a.membership_id = m.id AND a.clock_out IS NOT NULL AND a.clock_in >= ($2::date)::timestamp AT TIME ZONE $4
                  AND a.clock_in < (($3::date) + 1)::timestamp AT TIME ZONE $4) AS worked,
              (SELECT coalesce(sum(i.minutes), 0) / 60.0 FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id
                WHERE i.membership_id = m.id AND i.kind = 'overtime' AND r.period_end BETWEEN $2 AND $3) AS overtime
         FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN departments d ON d.id = m.department_id
        WHERE m.business_id = $1 AND m.status <> 'archived' AND ${f} ORDER BY u.name`, params);
    const r2 = (n) => Math.round(Number(n) * 100) / 100;
    return {
      columns: [col('employee', 'Employee', 'الموظف'), col('department', 'Department', 'القسم'), col('scheduled', 'Scheduled hours', 'الساعات المجدولة', 'number'), col('worked', 'Worked hours', 'الساعات المنجزة', 'number'), col('overtime', 'Overtime hours', 'ساعات إضافية', 'number')],
      rows: rows.map((r) => ({ employee: r.name, department: r.department, scheduled: r2(r.scheduled), worked: r2(r.worked), overtime: r2(r.overtime) })),
    };
  }
  case 'attendance': {
    const params = [biz.id, from, to, tz];
    const f = peopleFilter(params);
    const { rows } = await db.query(
      `SELECT u.name, a.clock_in, a.clock_out, a.break_minutes, a.source, s.starts_at AS shift_start
         FROM attendance a JOIN memberships m ON m.id = a.membership_id JOIN users u ON u.id = m.user_id LEFT JOIN shifts s ON s.id = a.shift_id
        WHERE a.business_id = $1 AND a.clock_in >= ($2::date)::timestamp AT TIME ZONE $4 AND a.clock_in < (($3::date) + 1)::timestamp AT TIME ZONE $4 AND ${f}
        ORDER BY a.clock_in`, params);
    const local = (d) => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16) : null);
    return {
      columns: [col('employee', 'Employee', 'الموظف'), col('clockIn', 'Clock in', 'وقت الدخول'), col('clockOut', 'Clock out', 'وقت الخروج'), col('breakMinutes', 'Break (min)', 'الاستراحة (دقيقة)', 'number'), col('hours', 'Hours', 'الساعات', 'number'), col('late', 'Late (min)', 'التأخير (دقيقة)', 'number'), col('source', 'Recorded by', 'سُجّل بواسطة')],
      rows: rows.map((r) => ({
        employee: r.name, clockIn: local(r.clock_in), clockOut: local(r.clock_out), breakMinutes: r.break_minutes,
        hours: r.clock_out ? Math.round(((new Date(r.clock_out) - new Date(r.clock_in)) / 3600000 - r.break_minutes / 60) * 100) / 100 : null,
        late: r.shift_start ? Math.max(0, Math.round((new Date(r.clock_in) - new Date(r.shift_start)) / 60000)) : null,
        source: r.source === 'self' ? 'Employee' : 'Manager',
      })),
    };
  }
  case 'shifts': {
    const params = [biz.id, from, to, tz];
    const f = peopleFilter(params);
    const { rows } = await db.query(
      `SELECT s.starts_at, s.ends_at, s.break_minutes, s.status, u.name, d.name AS department,
              (SELECT count(*) FROM shift_history h WHERE h.shift_id = s.id AND h.change_type IN ('updated', 'reassigned', 'swapped', 'unassigned'))::int AS changes
         FROM shifts s LEFT JOIN memberships m ON m.id = s.membership_id LEFT JOIN users u ON u.id = m.user_id LEFT JOIN departments d ON d.id = s.department_id
        WHERE s.business_id = $1 AND s.starts_at >= ($2::date)::timestamp AT TIME ZONE $4 AND s.starts_at < (($3::date) + 1)::timestamp AT TIME ZONE $4
          AND (s.membership_id IS NULL OR ${f}) ORDER BY s.starts_at`, params);
    const local = (d) => new Date(d).toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16);
    return {
      columns: [col('start', 'Start', 'البداية'), col('end', 'End', 'النهاية'), col('employee', 'Employee', 'الموظف'), col('department', 'Department', 'القسم'), col('hours', 'Hours', 'الساعات', 'number'), col('status', 'Status', 'الحالة'), col('changes', 'Changes', 'التغييرات', 'number')],
      rows: rows.map((r) => ({ start: local(r.starts_at), end: local(r.ends_at), employee: r.name || 'Open', department: r.department, hours: Math.round(((new Date(r.ends_at) - new Date(r.starts_at)) / 3600000 - r.break_minutes / 60) * 100) / 100, status: r.status, changes: r.changes })),
    };
  }
  default:
    throw notFound();
  }
}

function checkAccess(req, type) {
  const r = REPORTS[type];
  if (!r) throw notFound();
  if (!r.perm.every((p) => req.member.permissions.has(p))) throw forbidden();
}

export async function runReport(app, req, type, filters) {
  checkAccess(req, type);
  const biz = await business(req);
  const data = await build(app, req, type, filters);
  return { type, title: REPORTS[type].title, from: filters.from, to: filters.to, currency: biz.currency, currencyExponent: biz.currency_exponent, ...data };
}

// ---------- exports (background job) ----------

export async function requestExport(app, req, type, { format, locale, ...filters }) {
  checkAccess(req, type);
  if (!req.member.permissions.has('reports.export')) throw forbidden();
  assertRange(filters.from, filters.to);
  // Each export is real work in the background; 60 an hour per person is plenty.
  await rateLimit(app.db, `export:${req.auth.user.id}`, 60, 3600);
  const { rows: [job] } = await app.db.query(
    'INSERT INTO report_jobs (business_id, requested_by, report, format, params) VALUES ($1, $2, $3, $4, $5) RETURNING id, status',
    [req.member.businessId, req.auth.user.id, type, format, JSON.stringify({ ...filters, locale })]);
  await auditB(app.db, req, { action: 'report.exported', targetType: 'report', targetId: type, after: { format, ...filters } });
  setImmediate(() => processReportJobs(app).catch((err) => app.log.error({ err }, 'report job failed')));
  return { id: job.id, status: job.status };
}

export async function getExport(app, req, id) {
  const { rows: [j] } = await app.db.query(
    'SELECT id, report, format, status, document_id AS "documentId", error, created_at AS "createdAt" FROM report_jobs WHERE id = $1 AND business_id = $2 AND requested_by = $3',
    [id, req.member.businessId, req.auth.user.id]);
  if (!j) throw notFound();
  return j;
}

// Runs queued export jobs. The requester's permissions are checked again at
// run time, so a revoked permission stops a pending export.
export function processReportJobs(app) {
  // Overlapping calls share one run, which ends when the queue is empty.
  app.reportRun ??= drainReportJobs(app).finally(() => { app.reportRun = null; });
  return app.reportRun;
}

async function drainReportJobs(app) {
  for (;;) {
    const client = await app.db.connect();
    let job;
    try {
      await client.query('BEGIN');
      ({ rows: [job] } = await client.query(
        'UPDATE report_jobs SET status = \'running\' WHERE id = (SELECT id FROM report_jobs WHERE status = \'queued\' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *'));
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    if (!job) return;
    try {
      const { rows: [m] } = await app.db.query(
        'SELECT * FROM memberships WHERE business_id = $1 AND user_id = $2 AND status = \'active\'', [job.business_id, job.requested_by]);
      if (!m) throw forbidden();
      const req = {
        server: app, auth: { user: { id: job.requested_by } },
        member: { id: m.id, role: m.role, businessId: job.business_id, permissions: await loadPermissions(app.db, m) },
      };
      checkAccess(req, job.report);
      const biz = await business(req);
      const { locale = 'en', ...filters } = job.params;
      const data = await build(app, req, job.report, filters);
      const scale = 10 ** biz.currency_exponent;
      const columns = data.columns.map((c) => ({ key: c.key, label: c.kind === 'money' ? `${c.label[locale] || c.label.en} (${biz.currency})` : c.label[locale] || c.label.en }));
      const rows = data.rows.map((r) => Object.fromEntries(data.columns.map((c) => [c.key, c.kind === 'money' && r[c.key] !== null && r[c.key] !== undefined ? r[c.key] / scale : r[c.key]])));
      const title = REPORTS[job.report].title[locale] || REPORTS[job.report].title.en;
      const buf = job.format === 'csv' ? toCsv(columns, rows) : toXlsx(columns, rows, { sheetName: title, rtl: locale === 'ar' });
      const filename = `${job.report}-${filters.from}-${filters.to}.${job.format}`;
      const mime = job.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const docId = await saveGenerated(app, app.db, { businessId: job.business_id, userId: job.requested_by, filename, mime, buf });
      await app.db.query('UPDATE report_jobs SET status = \'done\', document_id = $2, finished_at = now() WHERE id = $1', [job.id, docId]);
    } catch (err) {
      app.log.error({ err, jobId: job.id }, 'report export failed');
      await app.db.query('UPDATE report_jobs SET status = \'failed\', error = $2, finished_at = now() WHERE id = $1',
        [job.id, err.code === 'forbidden' ? 'Permission removed' : 'The report could not be created.']);
    }
  }
}

