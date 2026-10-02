// Global search (spec §33). Each group only appears when the person may see
// it, and the same scope rules as the rest of the app apply.
import { business, managedScope, scopeSql } from '../lib/context.js';
import { can } from '../auth/session.js';
import { availableReports } from './reports.js';

const like = (q) => `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;

export async function search(app, req, q) {
  const term = String(q || '').trim();
  if (term.length < 2) return { query: term, groups: [] };
  const biz = await business(req);
  const db = app.db;
  const groups = [];
  const add = (key, items) => { if (items.length) groups.push({ key, items }); };
  const pat = like(term);

  if (can(req, 'members.view')) {
    const params = [biz.id, pat];
    const cond = scopeSql(await managedScope(req), params);
    const { rows } = await db.query(
      `SELECT m.id, u.name, u.email, u.phone, m.role, m.status, m.profile->>'jobTitle' AS title FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.business_id = $1 AND ${cond} AND (u.name ILIKE $2 OR u.email ILIKE $2 OR u.phone ILIKE $2 OR m.profile->>'employeeNumber' ILIKE $2 OR m.profile->>'jobTitle' ILIKE $2)
        ORDER BY u.name LIMIT 6`, params);
    add('employees', rows.map((r) => ({ id: r.id, title: r.name, subtitle: [r.title, r.email || r.phone].filter(Boolean).join(' · '), role: r.role, status: r.status })));
  }
  const { rows: depts } = await db.query(
    'SELECT id, name FROM departments WHERE business_id = $1 AND archived_at IS NULL AND name ILIKE $2 ORDER BY name LIMIT 5', [biz.id, pat]);
  add('departments', depts.map((r) => ({ id: r.id, title: r.name })));

  if (can(req, 'schedules.view')) {
    const params = [biz.id, pat];
    const cond = scopeSql(await managedScope(req), params);
    const { rows } = await db.query(
      `SELECT s.id, s.starts_at, s.ends_at, u.name FROM shifts s JOIN memberships m ON m.id = s.membership_id JOIN users u ON u.id = m.user_id
        WHERE s.business_id = $1 AND ${cond} AND s.status <> 'cancelled' AND (u.name ILIKE $2 OR s.notes ILIKE $2)
          AND s.starts_at BETWEEN now() - interval '30 days' AND now() + interval '60 days' ORDER BY abs(extract(epoch FROM (s.starts_at - now()))) LIMIT 6`, params);
    add('shifts', rows.map((r) => ({ id: r.id, title: r.name, startsAt: r.starts_at, endsAt: r.ends_at })));
  }
  {
    const params = [biz.id, pat];
    let cond;
    if (can(req, 'employee_expenses.review')) cond = `${scopeSql(await managedScope(req), params)} AND e.status <> 'draft'`;
    else { params.push(req.member.id); cond = `e.membership_id = $${params.length}`; }
    const { rows } = await db.query(
      `SELECT e.id, e.amount, e.spent_on, e.description, e.status, u.name FROM employee_expenses e JOIN memberships m ON m.id = e.membership_id JOIN users u ON u.id = m.user_id
        WHERE e.business_id = $1 AND ${cond} AND (e.description ILIKE $2 OR e.business_purpose ILIKE $2 OR u.name ILIKE $2) ORDER BY e.spent_on DESC LIMIT 6`, params);
    add('employeeExpenses', rows.map((r) => ({ id: r.id, title: r.description, subtitle: r.name, amount: r.amount, date: r.spent_on, status: r.status })));
  }
  if (can(req, 'business_expenses.view')) {
    const { rows } = await db.query(
      `SELECT id, amount, spent_on, vendor, description FROM business_expenses WHERE business_id = $1 AND archived_at IS NULL
         AND (vendor ILIKE $2 OR description ILIKE $2 OR notes ILIKE $2) ORDER BY spent_on DESC LIMIT 6`, [biz.id, pat]);
    add('businessExpenses', rows.map((r) => ({ id: r.id, title: r.vendor || r.description, subtitle: r.vendor ? r.description : null, amount: r.amount, date: r.spent_on })));
  }
  if (can(req, 'revenue.view')) {
    const { rows } = await db.query(
      `SELECT id, amount, received_on, description, source FROM revenues WHERE business_id = $1 AND archived_at IS NULL
         AND (description ILIKE $2 OR source ILIKE $2 OR notes ILIKE $2) ORDER BY received_on DESC LIMIT 6`, [biz.id, pat]);
    add('revenue', rows.map((r) => ({ id: r.id, title: r.source || r.description, subtitle: r.source ? r.description : null, amount: r.amount, date: r.received_on })));
  }
  if (can(req, 'payroll.view') && /^\d{4}(-\d{1,2})?/.test(term)) {
    const { rows } = await db.query(
      `SELECT id, period_start, period_end, status FROM payroll_runs WHERE business_id = $1 AND (to_char(period_start, 'YYYY-MM-DD') LIKE $2 OR to_char(period_end, 'YYYY-MM-DD') LIKE $2)
        ORDER BY period_start DESC LIMIT 5`, [biz.id, `${term.replace(/[%_\\]/g, '')}%`]);
    add('payroll', rows.map((r) => ({ id: r.id, title: `${r.period_start} – ${r.period_end}`, startDate: r.period_start, endDate: r.period_end, status: r.status })));
  }
  const lower = term.toLowerCase();
  add('reports', availableReports(req).filter((r) => r.title.en.toLowerCase().includes(lower) || r.title.ar.includes(term)).map((r) => ({ id: r.key, title: r.title })));
  return { query: term, groups };
}
