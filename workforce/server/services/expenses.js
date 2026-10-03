// Employee work expenses (spec §7) and their approval workflow (spec §34).
import { transaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertRange, auditB, business, history, inScope, managedScope, scopeSql } from '../lib/context.js';
import { notify, notifyApprovers, notifyMember } from '../lib/notify.js';
import { can } from '../auth/session.js';

const out = (r) => ({
  id: r.id, membershipId: r.membership_id, memberName: r.member_name ?? null, amount: r.amount, currency: r.currency,
  spentOn: r.spent_on, categoryId: r.category_id, categoryKey: r.category_key ?? null, categoryEn: r.name_en ?? null, categoryAr: r.name_ar ?? null,
  icon: r.icon ?? null, description: r.description, businessPurpose: r.business_purpose, location: r.location,
  receiptDocumentId: r.receipt_document_id, status: r.status, approvalStep: r.approval_step, needsOwner: r.needs_owner,
  submittedAt: r.submitted_at, decidedAt: r.decided_at, reimbursedAt: r.reimbursed_at, rejectionReason: r.rejection_reason,
  payrollRunId: r.payroll_run_id, createdAt: r.created_at,
});

const SELECT = `SELECT e.*, u.name AS member_name, c.key AS category_key, c.name_en, c.name_ar, c.icon
  FROM employee_expenses e JOIN memberships m ON m.id = e.membership_id JOIN users u ON u.id = m.user_id
  JOIN expense_categories c ON c.id = e.category_id`;

const dateOnly = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

export async function listEmployeeExpenses(app, req, { mine, status, from, to, membershipId }) {
  const params = [req.member.businessId];
  const where = ['e.business_id = $1'];
  if (mine || !can(req, 'employee_expenses.review')) {
    params.push(req.member.id);
    where.push(`e.membership_id = $${params.length}`);
  } else {
    where.push(scopeSql(await managedScope(req), params));
    where.push('e.status <> \'draft\'');
    if (membershipId) { params.push(membershipId); where.push(`e.membership_id = $${params.length}`); }
  }
  if (status) { params.push(status); where.push(`e.status = $${params.length}`); }
  if (from && to) {
    assertRange(from, to);
    params.push(from, to);
    where.push(`e.spent_on BETWEEN $${params.length - 1} AND $${params.length}`);
  }
  const { rows } = await app.db.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.spent_on DESC, e.created_at DESC LIMIT 1000`, params);
  return rows.map(out);
}

export async function getEmployeeExpense(app, req, id) {
  const { rows: [r] } = await app.db.query(`${SELECT} WHERE e.id = $1 AND e.business_id = $2`, [id, req.member.businessId]);
  if (!r) throw notFound();
  if (r.membership_id !== req.member.id && !(can(req, 'employee_expenses.review') && r.status !== 'draft' && (await inScope(req, r.membership_id)))) throw notFound();
  const { rows: steps } = await app.db.query(
    `SELECT a.step, a.decision, a.note, a.created_at AS "createdAt", u.name AS "by" FROM approvals a JOIN users u ON u.id = a.decided_by
      WHERE a.subject_type = 'employee_expense' AND a.subject_id = $1 ORDER BY a.id`, [id]);
  return { ...out(r), approvals: steps };
}

async function checkInput(db, req, { categoryId, receiptDocumentId, spentOn }) {
  const { rows: [c] } = await db.query(
    'SELECT employee_claimable FROM expense_categories WHERE id = $1 AND business_id = $2 AND archived_at IS NULL', [categoryId, req.member.businessId]);
  if (!c || !c.employee_claimable) throw badRequest('invalid_category', 'Choose one of the work expense categories.');
  if (receiptDocumentId) {
    const { rows: [d] } = await db.query(
      'SELECT 1 FROM documents WHERE id = $1 AND business_id = $2 AND uploaded_by = $3 AND kind = \'receipt\' AND archived_at IS NULL',
      [receiptDocumentId, req.member.businessId, req.auth.user.id]);
    if (!d) throw badRequest('invalid_receipt', 'Upload the receipt again.');
  }
  if (spentOn > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw badRequest('future_date', 'The date can\'t be in the future.');
}

async function submitted(db, req, biz, e) {
  await db.query(
    'INSERT INTO approvals (business_id, subject_type, subject_id, step, decision, note, decided_by) VALUES ($1, \'employee_expense\', $2, 0, \'review\', \'Submitted\', $3)',
    [biz.id, e.id, req.auth.user.id]);
  await notifyApprovers(db, biz.id, 'employee_expenses.review', e.membership_id, 'expense.submitted', { expenseId: e.id, amount: e.amount });
}

export async function createEmployeeExpense(app, req, input) {
  if (!can(req, 'self.expenses')) throw forbidden();
  const biz = await business(req);
  const id = await transaction(app.db, async (db) => {
    await checkInput(db, req, input);
    const status = input.submit ? 'submitted' : 'draft';
    const { rows: [e] } = await db.query(
      `INSERT INTO employee_expenses (business_id, membership_id, amount, currency, spent_on, category_id, description, business_purpose,
         location, receipt_document_id, status, needs_owner, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $11 = 'submitted' THEN now() END) RETURNING *`,
      [biz.id, req.member.id, input.amount, biz.currency, input.spentOn, input.categoryId, input.description, input.businessPurpose ?? null,
        input.location ?? null, input.receiptDocumentId ?? null, status, input.amount > biz.settings.approvals.expenseOwnerOver]);
    await history(db, req, 'employee_expense', e.id, 'created', null, out(e));
    await auditB(db, req, { action: 'employee_expense.created', targetType: 'employee_expense', targetId: e.id, after: { amount: e.amount, status } });
    if (status === 'submitted') await submitted(db, req, biz, e);
    return e.id;
  });
  return getEmployeeExpense(app, req, id);
}

// Owners of a draft (or a rejected claim) can fix it and send it again.
export async function updateEmployeeExpense(app, req, id, input) {
  const biz = await business(req);
  await transaction(app.db, async (db) => {
    const { rows: [e] } = await db.query('SELECT * FROM employee_expenses WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, biz.id]);
    if (!e || e.membership_id !== req.member.id) throw notFound();
    if (!['draft', 'rejected'].includes(e.status)) throw conflict('locked', 'Submitted expenses can\'t be edited. Ask your manager to reject it if something is wrong.');
    const next = { ...input, categoryId: input.categoryId ?? e.category_id, spentOn: input.spentOn ?? dateOnly(e.spent_on) };
    await checkInput(db, req, next);
    const amount = input.amount ?? e.amount;
    const status = input.submit ? 'submitted' : e.status === 'rejected' ? 'draft' : e.status;
    const { rows: [u] } = await db.query(
      `UPDATE employee_expenses SET amount = $2, spent_on = $3, category_id = $4, description = coalesce($5, description),
         business_purpose = coalesce($6, business_purpose), location = coalesce($7, location), receipt_document_id = coalesce($8, receipt_document_id),
         status = $9, approval_step = 1, needs_owner = $10, rejection_reason = CASE WHEN $9 = 'submitted' THEN NULL ELSE rejection_reason END,
         submitted_at = CASE WHEN $9 = 'submitted' THEN now() ELSE submitted_at END, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, amount, next.spentOn, next.categoryId, input.description ?? null, input.businessPurpose ?? null, input.location ?? null,
        input.receiptDocumentId ?? null, status, amount > biz.settings.approvals.expenseOwnerOver]);
    await history(db, req, 'employee_expense', id, 'updated', out(e), out(u));
    if (status === 'submitted') await submitted(db, req, biz, u);
  });
  return getEmployeeExpense(app, req, id);
}

export async function deleteDraft(app, req, id) {
  const { rows: [e] } = await app.db.query('SELECT * FROM employee_expenses WHERE id = $1 AND business_id = $2', [id, req.member.businessId]);
  if (!e || e.membership_id !== req.member.id) throw notFound();
  if (e.status !== 'draft') throw conflict('locked', 'Only drafts can be deleted.');
  await transaction(app.db, async (db) => {
    await history(db, req, 'employee_expense', id, 'deleted', out(e), null);
    await db.query('DELETE FROM employee_expenses WHERE id = $1', [id]);
  });
}

/**
 * review: mark as being looked at. approve: step 1 is the manager; claims over
 * the owner threshold then wait for the owner (step 2). reject: needs a reason.
 * Nobody can decide their own claim.
 */
export async function decideEmployeeExpense(app, req, id, { action, note }) {
  const biz = await business(req);
  await transaction(app.db, async (db) => {
    const { rows: [e] } = await db.query('SELECT * FROM employee_expenses WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, biz.id]);
    if (!e || e.status === 'draft') throw notFound();
    if (e.membership_id === req.member.id) throw forbidden('You can\'t approve your own expense.');
    if (!(await inScope(req, e.membership_id))) throw forbidden();
    if (!['submitted', 'under_review'].includes(e.status)) throw conflict('not_pending', 'This expense has already been decided.');
    const isOwner = req.member.role === 'owner';
    let status;
    let step = e.approval_step;
    if (action === 'review') {
      if (!can(req, 'employee_expenses.review')) throw forbidden();
      status = 'under_review';
    } else if (action === 'reject') {
      if (!can(req, 'employee_expenses.approve')) throw forbidden();
      if (!note) throw badRequest('reason_required', 'Give a reason for rejecting.');
      status = 'rejected';
    } else {
      if (!can(req, 'employee_expenses.approve')) throw forbidden();
      if (e.approval_step === 2 && !isOwner) throw forbidden('This expense is waiting for the owner\'s approval.');
      if (e.needs_owner && !isOwner) { status = 'under_review'; step = 2; } else status = 'approved';
    }
    await db.query(
      `UPDATE employee_expenses SET status = $2, approval_step = $3, rejection_reason = CASE WHEN $2 = 'rejected' THEN $4 ELSE rejection_reason END,
         decided_at = CASE WHEN $2 IN ('approved', 'rejected') THEN now() ELSE decided_at END, updated_at = now() WHERE id = $1`,
      [id, status, step, note ?? null]);
    await db.query(
      'INSERT INTO approvals (business_id, subject_type, subject_id, step, decision, note, decided_by) VALUES ($1, \'employee_expense\', $2, $3, $4, $5, $6)',
      [biz.id, id, e.approval_step, action, note ?? null, req.auth.user.id]);
    await history(db, req, 'employee_expense', id, action, { status: e.status, step: e.approval_step }, { status, step }, note);
    await auditB(db, req, { action: `employee_expense.${action === 'approve' ? (status === 'approved' ? 'approved' : 'approved_step1') : action}`, targetType: 'employee_expense', targetId: id, after: { amount: e.amount, status, note } });
    if (status === 'approved') await notifyMember(db, biz.id, e.membership_id, 'expense.approved', { expenseId: id, amount: e.amount });
    if (status === 'rejected') await notifyMember(db, biz.id, e.membership_id, 'expense.rejected', { expenseId: id, reason: note });
    if (step === 2 && e.approval_step === 1) {
      const owners = await db.query('SELECT user_id FROM memberships WHERE business_id = $1 AND role = \'owner\' AND status = \'active\'', [biz.id]);
      for (const o of owners.rows) await notify(db, { businessId: biz.id, userId: o.user_id, type: 'expense.owner_approval', data: { expenseId: id, amount: e.amount } });
    }
  });
  return getEmployeeExpense(app, req, id);
}

// Paid back outside payroll (e.g. cash from the till).
export async function markReimbursed(app, req, id) {
  await transaction(app.db, async (db) => {
    const { rows: [e] } = await db.query('SELECT * FROM employee_expenses WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
    if (!e) throw notFound();
    if (e.membership_id === req.member.id && req.member.role !== 'owner') throw forbidden();
    if (e.status !== 'approved') throw conflict('not_approved', 'Only approved expenses can be reimbursed.');
    if (e.payroll_run_id) throw conflict('in_payroll', 'This expense is being repaid through payroll.');
    await db.query('UPDATE employee_expenses SET status = \'reimbursed\', reimbursed_at = now(), updated_at = now() WHERE id = $1', [id]);
    await db.query(
      'INSERT INTO approvals (business_id, subject_type, subject_id, step, decision, decided_by) VALUES ($1, \'employee_expense\', $2, 3, \'reimburse\', $3)',
      [req.member.businessId, id, req.auth.user.id]);
    await history(db, req, 'employee_expense', id, 'reimbursed', { status: 'approved' }, { status: 'reimbursed' });
    await auditB(db, req, { action: 'employee_expense.reimbursed', targetType: 'employee_expense', targetId: id, after: { amount: e.amount } });
    await notifyMember(db, req.member.businessId, e.membership_id, 'expense.reimbursed', { expenseId: id, amount: e.amount });
  });
  return getEmployeeExpense(app, req, id);
}
