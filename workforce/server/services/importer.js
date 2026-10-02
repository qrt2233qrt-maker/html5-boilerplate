// Imports the existing Business Expenses artifact's data (spec Phase 8).
// Re-running is safe: each record carries an import reference.
import { transaction } from '../db/pool.js';
import { auditB, business } from '../lib/context.js';

// Old category ids -> new built-in category keys.
const CATEGORY_MAP = {
  office: 'supplies', rent: 'rent', generator: 'electricity', fuel: 'fuel', travel: 'transport', meals: 'meals',
  marketing: 'marketing', software: 'software', equipment: 'equipment', repairs: 'maintenance', fees: 'professional',
  bankfees: 'bankfees', taxes: 'taxes', other: 'other',
};
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
