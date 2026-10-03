// Employee profiles, pay-rate history, termination, archive and deletion.
import { transaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { auditB, inScope } from '../lib/context.js';
import { notify } from '../lib/notify.js';
import { can } from '../auth/session.js';

const isSelf = (req, id) => req.member.id === id;

async function loadMember(db, req, id, lock = false) {
  const { rows: [m] } = await db.query(
    `SELECT m.*, u.name, u.email, u.phone, d.name AS department_name, ru.name AS reports_to_name
       FROM memberships m JOIN users u ON u.id = m.user_id
       LEFT JOIN departments d ON d.id = m.department_id
       LEFT JOIN memberships rm ON rm.id = m.reports_to LEFT JOIN users ru ON ru.id = rm.user_id
      WHERE m.id = $1 AND m.business_id = $2${lock ? ' FOR UPDATE OF m' : ''}`, [id, req.member.businessId]);
  if (!m) throw notFound();
  return m;
}

async function canSee(req, id) {
  if (isSelf(req, id)) return true;
  return can(req, 'members.view') && inScope(req, id);
}

// The rate in force on the business's own date (rates start on its local
// date, which can be a day ahead of the server's).
export const currentPaySql = `(SELECT row_to_json(p) FROM (SELECT pay_type AS "payType", rate, effective_from AS "effectiveFrom", frequency
  FROM pay_rates WHERE membership_id = m.id
   AND effective_from <= (now() AT TIME ZONE (SELECT timezone FROM businesses b WHERE b.id = m.business_id))::date
  ORDER BY effective_from DESC, created_at DESC LIMIT 1) p)`;

export async function getMember(app, req, id) {
  if (!(await canSee(req, id))) throw notFound();
  const m = await loadMember(app.db, req, id);
  const sensitiveOk = isSelf(req, id) || can(req, 'members.view_sensitive');
  const payOk = isSelf(req, id) || can(req, 'members.view_sensitive') || can(req, 'payroll.view');
  let pay = null;
  if (payOk) {
    const { rows: [p] } = await app.db.query(`SELECT ${currentPaySql} AS pay FROM memberships m WHERE m.id = $1`, [id]);
    pay = p.pay;
  }
  return {
    membershipId: m.id, userId: m.user_id, name: m.name, email: m.email, phone: m.phone, role: m.role, status: m.status,
    profile: m.profile, departmentId: m.department_id, departmentName: m.department_name, reportsTo: m.reports_to,
    reportsToName: m.reports_to_name, endDate: m.end_date, terminationReason: sensitiveOk ? m.termination_reason : undefined,
    joinedAt: m.created_at, pay,
    sensitive: sensitiveOk && m.sensitive_enc ? JSON.parse(decrypt(m.sensitive_enc, app.config.encryptionKey)) : (sensitiveOk ? {} : undefined),
  };
}

const PROFILE_KEYS = ['employeeNumber', 'jobTitle', 'startDate', 'workPhone', 'notes'];

export async function updateMember(app, req, id, input) {
  const self = isSelf(req, id);
  const editor = can(req, 'members.edit') && (await inScope(req, id));
  if (!self && !editor) throw forbidden();
  // People editing themselves may only change their emergency details and work phone.
  if (self && !editor && (input.profile && Object.keys(input.profile).some((k) => k !== 'workPhone') || input.departmentId !== undefined || input.reportsTo !== undefined)) {
    throw forbidden('You can only change your contact and emergency details.');
  }
  if (input.sensitive && !self && !can(req, 'members.view_sensitive')) throw forbidden();
  return transaction(app.db, async (db) => {
    const m = await loadMember(db, req, id, true);
    if (m.role === 'owner' && !self && req.member.role !== 'owner') throw forbidden();
    const profile = { ...m.profile };
    for (const k of PROFILE_KEYS) if (input.profile && k in input.profile) profile[k] = input.profile[k] || undefined;
    if (input.departmentId) {
      const d = await db.query('SELECT 1 FROM departments WHERE id = $1 AND business_id = $2 AND archived_at IS NULL', [input.departmentId, req.member.businessId]);
      if (!d.rows[0]) throw badRequest('invalid_department', 'Choose an active department.');
    }
    if (input.reportsTo) {
      if (input.reportsTo === id) throw badRequest('invalid_manager', 'Someone can\'t report to themselves.');
      const r = await db.query('SELECT role FROM memberships WHERE id = $1 AND business_id = $2', [input.reportsTo, req.member.businessId]);
      if (!r.rows[0] || r.rows[0].role === 'employee') throw badRequest('invalid_manager', 'Choose a manager or owner.');
    }
    const sensitive = input.sensitive ? encrypt(JSON.stringify(input.sensitive), app.config.encryptionKey) : m.sensitive_enc;
    await db.query(
      `UPDATE memberships SET profile = $2, department_id = CASE WHEN $3::boolean THEN $4::uuid ELSE department_id END,
         reports_to = CASE WHEN $5::boolean THEN $6::uuid ELSE reports_to END, sensitive_enc = $7, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(profile), input.departmentId !== undefined, input.departmentId ?? null, input.reportsTo !== undefined, input.reportsTo ?? null, sensitive]);
    await auditB(db, req, {
      action: 'member.profile_updated', targetType: 'membership', targetId: id,
      before: { profile: m.profile, departmentId: m.department_id, reportsTo: m.reports_to },
      after: { profile, departmentId: input.departmentId ?? m.department_id, reportsTo: input.reportsTo ?? m.reports_to, sensitiveChanged: !!input.sensitive },
    });
    return null;
  }).then(() => getMember(app, req, id));
}

// ---------- pay rates ----------

export async function listPayRates(app, req, id) {
  const ok = isSelf(req, id) || ((can(req, 'members.view_sensitive') || can(req, 'payroll.view')) && (await inScope(req, id)));
  if (!ok) throw forbidden();
  const { rows } = await app.db.query(
    `SELECT p.id, p.pay_type AS "payType", p.rate, p.frequency, p.effective_from AS "effectiveFrom", p.note, p.created_at AS "createdAt", u.name AS "createdBy"
       FROM pay_rates p LEFT JOIN users u ON u.id = p.created_by
      WHERE p.membership_id = $1 AND p.business_id = $2 ORDER BY p.effective_from DESC, p.created_at DESC`, [id, req.member.businessId]);
  return rows;
}

// A new row, never an edit: the old rate (and how often it was paid) stays
// in force up to the day before. `frequency` null follows the business default.
export async function addPayRate(app, req, id, { payType, rate, effectiveFrom, note, frequency = null }) {
  return transaction(app.db, async (db) => {
    const m = await loadMember(db, req, id, true);
    if (m.role === 'owner' && req.member.role !== 'owner') throw forbidden();
    if (!(await inScope(req, id))) throw forbidden();
    const { rows: [prev] } = await db.query(
      'SELECT pay_type, rate, frequency, effective_from FROM pay_rates WHERE membership_id = $1 ORDER BY effective_from DESC, created_at DESC LIMIT 1', [id]);
    const { rows: [row] } = await db.query(
      `INSERT INTO pay_rates (business_id, membership_id, pay_type, rate, effective_from, note, created_by, frequency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [req.member.businessId, id, payType, rate, effectiveFrom, note ?? null, req.auth.user.id, frequency]);
    await auditB(db, req, { action: 'member.pay_changed', targetType: 'membership', targetId: id, before: prev || null, after: { pay_type: payType, rate, frequency, effective_from: effectiveFrom } });
    return { id: row.id };
  });
}

// Rate in force on a date (used by payroll).
export async function rateOn(db, membershipId, day) {
  const { rows: [r] } = await db.query(
    `SELECT pay_type, rate FROM pay_rates WHERE membership_id = $1 AND effective_from <= $2::date
      ORDER BY effective_from DESC, created_at DESC LIMIT 1`, [membershipId, day]);
  return r || null;
}

// ---------- lifecycle ----------

async function guardTarget(req, m) {
  if (m.role === 'owner') throw forbidden('The owner\'s account can\'t be changed here.');
  if (isSelf(req, m.id)) throw forbidden('You can\'t change your own access.');
  if (req.member.role !== 'owner' && m.role !== 'employee') throw forbidden();
  if (!(await inScope(req, m.id))) throw forbidden();
}

// Ends employment without destroying history (spec §20).
export async function terminate(app, req, id, { endDate, reason }) {
  return transaction(app.db, async (db) => {
    const m = await loadMember(db, req, id, true);
    await guardTarget(req, m);
    if (m.status === 'terminated' || m.status === 'archived') throw conflict('invalid_status', 'This person has already left.');
    await db.query(
      'UPDATE memberships SET status = \'terminated\', end_date = $2, termination_reason = $3, updated_at = now() WHERE id = $1',
      [id, endDate, reason]);
    // Future shifts are cancelled (kept, with history), not deleted.
    const { rows: shifts } = await db.query(
      `UPDATE shifts SET status = 'cancelled', updated_at = now()
        WHERE membership_id = $1 AND status = 'scheduled' AND starts_at > now() RETURNING id, starts_at, ends_at`, [id]);
    for (const s of shifts) {
      await db.query(
        `INSERT INTO shift_history (business_id, shift_id, change_type, before, after, reason, changed_by)
         VALUES ($1, $2, 'cancelled', $3, $4, 'Employment ended', $5)`,
        [req.member.businessId, s.id, JSON.stringify({ status: 'scheduled', membershipId: id }), JSON.stringify({ status: 'cancelled' }), req.auth.user.id]);
    }
    await db.query('UPDATE shift_requests SET status = \'cancelled\', updated_at = now() WHERE (membership_id = $1 OR taker_membership_id = $1) AND status = \'pending\'', [id]);
    await db.query(`UPDATE shift_swaps SET status = 'cancelled', updated_at = now()
      WHERE (requester_membership_id = $1 OR target_membership_id = $1) AND status IN ('pending_peer', 'pending_approval')`, [id]);
    await db.query('UPDATE attendance SET clock_out = now(), note = coalesce(note, \'\') || \' [closed at termination]\' WHERE membership_id = $1 AND clock_out IS NULL', [id]);
    // Sign them out if this was their only active business.
    const other = await db.query('SELECT 1 FROM memberships WHERE user_id = $1 AND id <> $2 AND status = \'active\'', [m.user_id, id]);
    if (!other.rows[0]) await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [m.user_id]);
    await auditB(db, req, { action: 'member.terminated', targetType: 'membership', targetId: id, before: { status: m.status }, after: { status: 'terminated', endDate, reason, shiftsCancelled: shifts.length } });
    return { shiftsCancelled: shifts.length };
  });
}

export async function reinstate(app, req, id) {
  if (req.member.role !== 'owner') throw forbidden();
  return transaction(app.db, async (db) => {
    const m = await loadMember(db, req, id, true);
    if (!['terminated', 'archived'].includes(m.status)) throw conflict('invalid_status', 'Only people who left can be reinstated.');
    await db.query('UPDATE memberships SET status = \'active\', end_date = NULL, termination_reason = NULL, updated_at = now() WHERE id = $1', [id]);
    await auditB(db, req, { action: 'member.reinstated', targetType: 'membership', targetId: id, before: { status: m.status }, after: { status: 'active' } });
    await notify(db, { businessId: req.member.businessId, userId: m.user_id, type: 'member.active', data: {} });
  });
}

export async function archiveMember(app, req, id) {
  return transaction(app.db, async (db) => {
    const m = await loadMember(db, req, id, true);
    await guardTarget(req, m);
    if (m.status !== 'terminated') throw conflict('invalid_status', 'End this person\'s employment before archiving.');
    await db.query('UPDATE memberships SET status = \'archived\', updated_at = now() WHERE id = $1', [id]);
    await auditB(db, req, { action: 'member.archived', targetType: 'membership', targetId: id, before: { status: m.status }, after: { status: 'archived' } });
  });
}

// Permanent removal: owner only, typed confirmation, a reason, and only when
// no pay, expense or attendance records depend on the person.
export async function deleteMember(app, req, id, { confirm, reason }) {
  if (!can(req, 'records.hard_delete')) throw forbidden();
  return transaction(app.db, async (db) => {
    const m = await loadMember(db, req, id, true);
    await guardTarget(req, m);
    if (confirm !== m.name) throw badRequest('confirm_mismatch', 'Type the person\'s full name exactly to confirm.');
    if (m.status !== 'archived') throw conflict('invalid_status', 'Archive this person before deleting them permanently.');
    const deps = await db.query(
      `SELECT (SELECT count(*) FROM payroll_items WHERE membership_id = $1) + (SELECT count(*) FROM employee_expenses WHERE membership_id = $1)
            + (SELECT count(*) FROM attendance WHERE membership_id = $1) AS n`, [id]);
    if (deps.rows[0].n > 0) throw conflict('has_records', 'This person has pay, expense or attendance records that must be kept. Keep them archived instead.');
    const snapshot = { name: m.name, email: m.email, phone: m.phone, role: m.role, profile: m.profile, joinedAt: m.created_at };
    // Shifts, requests and documents that pointed at them lose the link but stay.
    await db.query('UPDATE shifts SET membership_id = NULL WHERE membership_id = $1', [id]);
    await db.query('DELETE FROM shift_requests WHERE membership_id = $1 OR taker_membership_id = $1', [id]);
    await db.query('DELETE FROM shift_swaps WHERE requester_membership_id = $1 OR target_membership_id = $1', [id]);
    await db.query('DELETE FROM unavailability WHERE membership_id = $1', [id]);
    await db.query('DELETE FROM pay_rates WHERE membership_id = $1', [id]);
    await db.query('DELETE FROM membership_permissions WHERE membership_id = $1', [id]);
    await db.query('UPDATE documents SET membership_id = NULL WHERE membership_id = $1', [id]);
    await db.query('UPDATE departments SET manager_membership_id = NULL WHERE manager_membership_id = $1', [id]);
    await db.query('UPDATE memberships SET reports_to = NULL WHERE reports_to = $1', [id]);
    await db.query('DELETE FROM payroll_statements WHERE membership_id = $1', [id]);
    await db.query('DELETE FROM memberships WHERE id = $1', [id]);
    await auditB(db, req, { action: 'member.deleted', targetType: 'membership', targetId: id, before: snapshot, after: { reason } });
  });
}
