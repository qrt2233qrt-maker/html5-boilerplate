// Imports the existing Business Expenses artifact's data (spec Phase 8).
// Re-running is safe: each record carries an import reference.
import { transaction } from '../db/pool.js';
import { createHash } from 'node:crypto';
import { badRequest } from '../lib/errors.js';
import { auditB, business } from '../lib/context.js';

// Old category ids -> new built-in category keys.
const CATEGORY_MAP = {
  office: 'supplies', rent: 'rent', generator: 'electricity', fuel: 'fuel', travel: 'transport', meals: 'meals',
  marketing: 'marketing', software: 'software', equipment: 'equipment', repairs: 'maintenance', fees: 'professional',
  bankfees: 'bankfees', taxes: 'taxes', other: 'other',
};
// The app's CSV export names categories "English / Arabic".
const CATEGORY_BY_NAME = {
  'office & supplies': 'office', 'rent & utilities': 'rent', 'generator & electricity': 'generator', fuel: 'fuel',
  'travel & transport': 'travel', 'meals & hospitality': 'meals', 'marketing & ads': 'marketing', 'software & subscriptions': 'software',
  equipment: 'equipment', 'maintenance & repairs': 'repairs', 'professional fees': 'fees', 'bank & transfer fees': 'bankfees',
  'taxes & licenses': 'taxes', other: 'other',
};
const METHOD_BY_NAME = { cash: 'cash', card: 'card', 'bank transfer': 'bank', 'mobile wallet': 'wallet' };

// RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF, optional BOM).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

/**
 * Turns the Business Expenses app's "Export CSV" file into the import shape.
 * The CSV carries no record ids, so each row's reference is a hash of its
 * contents (plus a counter for identical rows): importing the same file, or
 * an overlapping one, again adds nothing twice.
 */
export function fromExpensesCsv(text) {
  const [head, ...rows] = parseCsv(String(text || ''));
  const col = Object.fromEntries((head || []).map((h, i) => [h.trim().toLowerCase(), i]));
  for (const need of ['date', 'amount', 'category']) {
    if (!(need in col)) throw badRequest('import_bad_file', 'This isn\'t a Business Expenses CSV export.');
  }
  const get = (r, name) => (name in col ? (r[col[name]] ?? '').trim() : '');
  const seen = new Map();
  const data = { expenses: [], approvals: {}, people: {} };
  for (const r of rows) {
    const date = get(r, 'date');
    const amount = Number(get(r, 'amount').replace(/[,\s]/g, ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount < 0) continue;
    const person = get(r, 'person') || 'Unknown';
    const uid = `csv-${createHash('sha256').update(person).digest('hex').slice(0, 16)}`;
    const base = createHash('sha256').update([date, get(r, 'vendor'), get(r, 'category'), amount, person, get(r, 'note')].join('\u241F')).digest('hex').slice(0, 24);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const id = n > 1 ? `${base}-${n}` : base;
    const catName = get(r, 'category').split(' / ')[0].trim().toLowerCase();
    data.expenses.push({
      uid, id, amount, date, vendor: get(r, 'vendor') || null, note: get(r, 'note') || null,
      categoryId: CATEGORY_BY_NAME[catName] || catName || 'other',
      method: METHOD_BY_NAME[get(r, 'payment method').toLowerCase()] || get(r, 'payment method') || null,
    });
    data.people[uid] = person;
    if (get(r, 'status').toLowerCase() === 'rejected') data.approvals[`${uid}__${id}`] = { status: 'rejected' };
  }
  return data;
}

const METHOD = { cash: 'Cash', card: 'Card', bank: 'Bank transfer', wallet: 'Mobile wallet' };

/**
 * data = {
 *   expenses: [{ uid, id, amount, categoryId, date, vendor, method, note, createdAt }],
 *   approvals: { "<uid>__<id>": { status, auto } },
 *   payrollRuns: { "YYYY-MM": { lines: { <employeeId>: { amount, date, method } } } },
 *   payrollEmployees: { <employeeId>: { name } },
 *   people: { <uid>: "Display name" }
 * }
 * Rejected expenses are skipped. Salary lines become expenses in the
 * Salaries category so past months keep their totals.
 */
export async function importExpensesApp(app, req, data) {
  const biz = await business(req);
  return transaction(app.db, async (db) => {
    const { rows: cats } = await db.query('SELECT id, key FROM expense_categories WHERE business_id = $1', [biz.id]);
    const catId = (key) => cats.find((c) => c.key === key)?.id;
    const result = { imported: 0, skippedRejected: 0, alreadyImported: 0, salaries: 0, unknownCategories: [] };
    for (const e of data.expenses || []) {
      const ref = `expenses-app:${e.uid}__${e.id}`;
      const status = data.approvals?.[`${e.uid}__${e.id}`]?.status;
      if (status === 'rejected') { result.skippedRejected++; continue; }
      const key = CATEGORY_MAP[e.categoryId];
      if (!key && !result.unknownCategories.includes(e.categoryId)) result.unknownCategories.push(e.categoryId);
      const who = data.people?.[e.uid];
      const notes = ['Imported from the Business Expenses app', who ? `by ${who}` : null, e.note || null].filter(Boolean).join(' · ');
      const ins = await db.query(
        `INSERT INTO business_expenses (business_id, amount, currency, spent_on, category_id, vendor, description, payment_method, notes, source, import_ref, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'import', $10, $11) ON CONFLICT (business_id, import_ref) WHERE import_ref IS NOT NULL DO NOTHING RETURNING id`,
        [biz.id, Math.round(e.amount), biz.currency, e.date, catId(key || 'other'), e.vendor || null, e.note || null, METHOD[e.method] || e.method || null, notes, ref, req.auth.user.id]);
      if (ins.rowCount) result.imported++; else result.alreadyImported++;
    }
    for (const [month, run] of Object.entries(data.payrollRuns || {})) {
      for (const [empId, line] of Object.entries(run.lines || {})) {
        if (!line.amount) continue;
        const day = line.date || new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
        const name = data.payrollEmployees?.[empId]?.name || 'Employee';
        const ins = await db.query(
          `INSERT INTO business_expenses (business_id, amount, currency, spent_on, category_id, vendor, description, payment_method, notes, source, import_ref, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Imported salary record', 'import', $9, $10) ON CONFLICT (business_id, import_ref) WHERE import_ref IS NOT NULL DO NOTHING RETURNING id`,
          [biz.id, Math.round(line.amount), biz.currency, day, catId('salaries'), name, `Salary ${month}`, METHOD[line.method] || null, `expenses-app:payroll:${month}:${empId}`, req.auth.user.id]);
        if (ins.rowCount) result.salaries++;
      }
    }
    await auditB(db, req, { action: 'import.expenses_app', targetType: 'business', targetId: biz.id, after: result });
    return result;
  });
}
