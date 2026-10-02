// Clock in/out, manager corrections (with history), and missed shifts.
import { transaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertRange, auditB, business, history, inScope, managedScope, scopeSql } from '../lib/context.js';
import { can } from '../auth/session.js';

const out = (r) => ({
  id: r.id, membershipId: r.membership_id, memberName: r.member_name ?? null, shiftId: r.shift_id,
  shiftStartsAt: r.shift_starts_at ?? null, shiftEndsAt: r.shift_ends_at ?? null,
  clockIn: r.clock_in, clockOut: r.clock_out, breakMinutes: r.break_minutes, source: r.source, note: r.note,
  hours: r.clock_out ? Math.max(0, (new Date(r.clock_out) - new Date(r.clock_in)) / 3600000 - r.break_minutes / 60) : null,
  lateMinutes: r.shift_starts_at ? Math.max(0, Math.round((new Date(r.clock_in) - new Date(r.shift_starts_at)) / 60000)) : null,
});

const SELECT = `SELECT a.*, u.name AS member_name, s.starts_at AS shift_starts_at, s.ends_at AS shift_ends_at
  FROM attendance a JOIN memberships m ON m.id = a.membership_id JOIN users u ON u.id = m.user_id
  LEFT JOIN shifts s ON s.id = a.shift_id`;

// The shift this clock-in belongs to: one running now or starting within 2 hours.
async function currentShift(db, membershipId) {
  const { rows: [s] } = await db.query(
    `SELECT id, ends_at FROM shifts WHERE membership_id = $1 AND status = 'scheduled'
       AND starts_at - interval '2 hours' <= now() AND ends_at > now() ORDER BY starts_at LIMIT 1`, [membershipId]);
  return s || null;
}

export async function clockIn(app, req, { note } = {}) {
  return transaction(app.db, async (db) => {
    await db.query('SELECT 1 FROM memberships WHERE id = $1 FOR UPDATE', [req.member.id]);
    const open = await db.query('SELECT 1 FROM attendance WHERE membership_id = $1 AND clock_out IS NULL', [req.member.id]);
    if (open.rows[0]) throw conflict('already_clocked_in', 'You are already clocked in.');
    const shift = await currentShift(db, req.member.id);
    const { rows: [a] } = await db.query(
      'INSERT INTO attendance (business_id, membership_id, shift_id, clock_in, note) VALUES ($1, $2, $3, now(), $4) RETURNING *',
      [req.member.businessId, req.member.id, shift?.id ?? null, note ?? null]);
    await auditB(db, req, { action: 'attendance.clock_in', targetType: 'attendance', targetId: a.id });
    return out(a);
  });
}

export async function clockOut(app, req, { breakMinutes = 0, note } = {}) {
  return transaction(app.db, async (db) => {
    const { rows: [a] } = await db.query('SELECT * FROM attendance WHERE membership_id = $1 AND clock_out IS NULL FOR UPDATE', [req.member.id]);
    if (!a) throw conflict('not_clocked_in', 'You are not clocked in.');
    const minutes = (Date.now() - new Date(a.clock_in)) / 60000;
    if (breakMinutes >= minutes) throw badRequest('invalid_break', 'The break is longer than the time worked.');
    const { rows: [u] } = await db.query(
      'UPDATE attendance SET clock_out = now(), break_minutes = $2, note = coalesce($3, note), updated_at = now() WHERE id = $1 RETURNING *',
      [a.id, breakMinutes, note ?? null]);
    if (a.shift_id) await db.query('UPDATE shifts SET status = \'completed\', updated_at = now() WHERE id = $1 AND status = \'scheduled\' AND ends_at <= now() + interval \'1 hour\'', [a.shift_id]);
    await auditB(db, req, { action: 'attendance.clock_out', targetType: 'attendance', targetId: a.id });
    return out(u);
  });
}

export async function listAttendance(app, req, { from, to, membershipId, mine }) {
  assertRange(from, to, 400);
  const biz = await business(req);
  const params = [req.member.businessId, from, to, biz.timezone];
  const where = ['a.business_id = $1', 'a.clock_in >= ($2::date)::timestamp AT TIME ZONE $4', 'a.clock_in < (($3::date) + 1)::timestamp AT TIME ZONE $4'];
  if (mine || !can(req, 'attendance.view')) {
    params.push(req.member.id);
    where.push(`a.membership_id = $${params.length}`);
  } else {
    where.push(scopeSql(await managedScope(req), params));
    if (membershipId) { params.push(membershipId); where.push(`a.membership_id = $${params.length}`); }
  }
  const { rows } = await app.db.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.clock_in DESC LIMIT 2000`, params);
  return rows.map(out);
}

// Scheduled shifts that ended with no clock-in at all.
export async function missedShifts(app, req, { from, to }) {
  assertRange(from, to, 400);
  const biz = await business(req);
  const params = [req.member.businessId, from, to, biz.timezone];
  const scope = can(req, 'attendance.view') ? scopeSql(await managedScope(req), params) : (params.push(req.member.id), `m.id = $${params.length}`);
  const { rows } = await app.db.query(
    `SELECT s.id, s.membership_id AS "membershipId", u.name AS "memberName", s.starts_at AS "startsAt", s.ends_at AS "endsAt"
       FROM shifts s JOIN memberships m ON m.id = s.membership_id JOIN users u ON u.id = m.user_id
      WHERE s.business_id = $1 AND s.status = 'scheduled' AND s.ends_at < now()
        AND s.starts_at >= ($2::date)::timestamp AT TIME ZONE $4 AND s.starts_at < (($3::date) + 1)::timestamp AT TIME ZONE $4
        AND ${scope}
        AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.membership_id = s.membership_id
                          AND a.clock_in < s.ends_at AND coalesce(a.clock_out, now()) > s.starts_at)
      ORDER BY s.starts_at DESC LIMIT 1000`, params);
  return rows;
}

function checkTimes(clockIn, clockOut, breakMinutes) {
  if (clockOut && new Date(clockOut) <= new Date(clockIn)) throw badRequest('invalid_times', 'Clock-out must be after clock-in.');
  if (new Date(clockIn) > new Date(Date.now() + 5 * 60000)) throw badRequest('invalid_times', 'Clock-in can\'t be in the future.');
  if (clockOut && breakMinutes >= (new Date(clockOut) - new Date(clockIn)) / 60000) throw badRequest('invalid_break', 'The break is longer than the time worked.');
}

// Manager adds a missing record.
export async function addAttendance(app, req, { membershipId, shiftId, clockIn, clockOut, breakMinutes = 0, note }) {
  if (!(await inScope(req, membershipId))) throw forbidden();
  checkTimes(clockIn, clockOut, breakMinutes);
  return transaction(app.db, async (db) => {
    const { rows: [m] } = await db.query('SELECT 1 FROM memberships WHERE id = $1 AND business_id = $2', [membershipId, req.member.businessId]);
    if (!m) throw notFound();
    if (shiftId) {
      const s = await db.query('SELECT 1 FROM shifts WHERE id = $1 AND membership_id = $2', [shiftId, membershipId]);
      if (!s.rows[0]) throw badRequest('invalid_shift', 'That shift belongs to someone else.');
    }
    const { rows: [a] } = await db.query(
      `INSERT INTO attendance (business_id, membership_id, shift_id, clock_in, clock_out, break_minutes, source, note)
       VALUES ($1, $2, $3, $4, $5, $6, 'manager', $7) RETURNING *`,
      [req.member.businessId, membershipId, shiftId ?? null, clockIn, clockOut ?? null, breakMinutes, note ?? null]);
    await history(db, req, 'attendance', a.id, 'created', null, out(a), note);
    await auditB(db, req, { action: 'attendance.added', targetType: 'attendance', targetId: a.id, after: { membershipId, clockIn, clockOut } });
    return out(a);
  });
}

export async function adjustAttendance(app, req, id, { clockIn, clockOut, breakMinutes, reason }) {
  return transaction(app.db, async (db) => {
    const { rows: [a] } = await db.query('SELECT * FROM attendance WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
    if (!a) throw notFound();
    if (!(await inScope(req, a.membership_id))) throw forbidden();
    if (a.membership_id === req.member.id && req.member.role !== 'owner') throw forbidden('Ask someone else to correct your own attendance.');
    const next = { clockIn: clockIn ?? a.clock_in, clockOut: clockOut !== undefined ? clockOut : a.clock_out, breakMinutes: breakMinutes ?? a.break_minutes };
    checkTimes(next.clockIn, next.clockOut, next.breakMinutes);
    if (await locked(db, a)) throw conflict('period_locked', 'This time is in a paid payroll period and can\'t be changed. Add an adjustment to the next payroll instead.');
    const { rows: [u] } = await db.query(
      'UPDATE attendance SET clock_in = $2, clock_out = $3, break_minutes = $4, source = \'manager\', updated_at = now() WHERE id = $1 RETURNING *',
      [id, next.clockIn, next.clockOut, next.breakMinutes]);
    await history(db, req, 'attendance', id, 'adjusted', out(a), out(u), reason);
    await auditB(db, req, { action: 'attendance.adjusted', targetType: 'attendance', targetId: id, before: { clockIn: a.clock_in, clockOut: a.clock_out, breakMinutes: a.break_minutes }, after: { ...next, reason } });
    return out(u);
  });
}

// Attendance inside a paid payroll period is part of the books.
async function locked(db, a) {
  const { rows } = await db.query(
    `SELECT 1 FROM payroll_runs r JOIN businesses b ON b.id = r.business_id
      WHERE r.business_id = $1 AND r.status = 'paid'
        AND ($2::timestamptz AT TIME ZONE b.timezone)::date BETWEEN r.period_start AND r.period_end`, [a.business_id, a.clock_in]);
  return !!rows[0];
}

export async function attendanceHistory(app, req, id) {
  const { rows: [a] } = await app.db.query('SELECT membership_id FROM attendance WHERE id = $1 AND business_id = $2', [id, req.member.businessId]);
  if (!a) throw notFound();
  if (a.membership_id !== req.member.id && !(can(req, 'attendance.view') && (await inScope(req, a.membership_id)))) throw notFound();
  const { rows } = await app.db.query(
    `SELECT h.change_type AS "changeType", h.before, h.after, h.reason, h.created_at AS "createdAt", u.name AS "changedBy"
       FROM record_history h LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.entity_type = 'attendance' AND h.entity_id = $1 ORDER BY h.id`, [id]);
  return rows;
}
