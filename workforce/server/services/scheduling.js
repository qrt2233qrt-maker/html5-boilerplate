// Shifts, timetables, availability and the validation every change goes through.
import { transaction } from '../db/pool.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertRange, auditB, business, inScope, managedScope, scopeSql } from '../lib/context.js';
import { notifyMember } from '../lib/notify.js';
import { can } from '../auth/session.js';

const HOUR = 3600000;

// ISO weekday trick: shift by k days so the business's first weekday becomes
// Monday, truncate to the week, shift back.
const weekShift = (weekStartsOn) => (1 - weekStartsOn + 7) % 7;

export function shiftOut(r) {
  return {
    id: r.id, membershipId: r.membership_id, memberName: r.member_name ?? null, departmentId: r.department_id,
    departmentName: r.department_name ?? null, locationId: r.location_id, locationName: r.location_name ?? null,
    startsAt: r.starts_at, endsAt: r.ends_at, breakMinutes: r.break_minutes, notes: r.notes, status: r.status,
    published: r.published, rescheduled: r.rescheduled ?? false,
    hours: Math.max(0, (new Date(r.ends_at) - new Date(r.starts_at)) / HOUR - r.break_minutes / 60),
  };
}

const SHIFT_SELECT = `SELECT s.*, u.name AS member_name, d.name AS department_name, l.name AS location_name,
    EXISTS (SELECT 1 FROM shift_history h WHERE h.shift_id = s.id AND h.change_type IN ('updated', 'reassigned', 'swapped')) AS rescheduled
  FROM shifts s LEFT JOIN memberships m ON m.id = s.membership_id LEFT JOIN users u ON u.id = m.user_id
  LEFT JOIN departments d ON d.id = s.department_id LEFT JOIN locations l ON l.id = s.location_id`;

/**
 * Checks that `membershipId` can work [startsAt, endsAt). Returns a list of
 * problems (empty when fine). `exclude` lists shift ids being replaced.
 * Callers lock the membership row first so two changes can't race.
 */
export async function scheduleProblems(db, biz, { membershipId, startsAt, endsAt, breakMinutes = 0, exclude = [] }) {
  const problems = [];
  const sched = biz.settings.scheduling;
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const { rows: [m] } = await db.query('SELECT status FROM memberships WHERE id = $1 AND business_id = $2', [membershipId, biz.id]);
  if (!m || m.status !== 'active') return [{ rule: 'inactive' }];
  const hours = (end - start) / HOUR - breakMinutes / 60;
  if ((end - start) / HOUR > sched.maxShiftHours) problems.push({ rule: 'shift_too_long', limit: sched.maxShiftHours });

  const rest = sched.minRestHours * HOUR;
  const { rows: clashes } = await db.query(
    `SELECT id, starts_at, ends_at FROM shifts
      WHERE membership_id = $1 AND status = 'scheduled' AND NOT (id = ANY($4::uuid[]))
        AND starts_at < $3::timestamptz + make_interval(secs => $5) AND ends_at > $2::timestamptz - make_interval(secs => $5)`,
    [membershipId, start, end, exclude, rest / 1000]);
  for (const c of clashes) {
    const overlaps = new Date(c.starts_at) < end && new Date(c.ends_at) > start;
    problems.push(overlaps ? { rule: 'overlap', shiftId: c.id } : { rule: 'rest', shiftId: c.id, limit: sched.minRestHours });
  }

  const { rows: off } = await db.query(
    'SELECT id, reason FROM unavailability WHERE membership_id = $1 AND starts_at < $3 AND ends_at > $2', [membershipId, start, end]);
  for (const u of off) problems.push({ rule: 'unavailable', reason: u.reason });

  const k = weekShift(biz.settings.payroll.weekStartsOn);
  const { rows: [w] } = await db.query(
    `WITH wk AS (SELECT (date_trunc('week', ($2::timestamptz AT TIME ZONE $3) + make_interval(days => $4)) - make_interval(days => $4)) AS ws)
     SELECT coalesce(sum(extract(epoch FROM (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0), 0)::float AS hours
       FROM shifts s, wk
      WHERE s.membership_id = $1 AND s.status = 'scheduled' AND NOT (s.id = ANY($5::uuid[]))
        AND (s.starts_at AT TIME ZONE $3) >= wk.ws AND (s.starts_at AT TIME ZONE $3) < wk.ws + interval '7 days'`,
    [membershipId, start, biz.timezone, k, exclude]);
  if (w.hours + hours > sched.maxWeeklyHours + 1e-9) {
    problems.push({ rule: 'weekly_hours', limit: sched.maxWeeklyHours, hours: Math.round((w.hours + hours) * 100) / 100 });
  }
  return problems;
}

export function scheduleError(problems) {
  return new AppError(409, 'schedule_conflict', 'This change conflicts with the schedule rules.', { problems });
}

export async function assertSchedulable(db, biz, input) {
  const problems = await scheduleProblems(db, biz, input);
  if (problems.length) throw scheduleError(problems);
}

export async function shiftHistory(db, req, shiftId, changeType, before, after, extra = {}) {
  await db.query(
    `INSERT INTO shift_history (business_id, shift_id, change_type, before, after, reason, approval_status, request_type, request_id, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [req.member.businessId, shiftId, changeType, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
      extra.reason ?? null, extra.approvalStatus ?? null, extra.requestType ?? null, extra.requestId ?? null, req.auth.user.id]);
}

const snap = (s) => ({
  membershipId: s.membership_id, startsAt: s.starts_at, endsAt: s.ends_at, breakMinutes: s.break_minutes,
  departmentId: s.department_id, locationId: s.location_id, status: s.status, notes: s.notes,
});

async function lockMember(db, id) {
  if (id) await db.query('SELECT 1 FROM memberships WHERE id = $1 FOR UPDATE', [id]);
}

async function ensureRefs(db, req, { departmentId, locationId, membershipId }) {
  if (membershipId) {
    const { rows: [m] } = await db.query('SELECT status FROM memberships WHERE id = $1 AND business_id = $2', [membershipId, req.member.businessId]);
    if (!m) throw badRequest('invalid_member', 'Choose someone from your team.');
    if (!(await inScope(req, membershipId))) throw forbidden('This person isn\'t in a department you manage.');
  }
  if (departmentId && !(await db.query('SELECT 1 FROM departments WHERE id = $1 AND business_id = $2', [departmentId, req.member.businessId])).rows[0]) {
    throw badRequest('invalid_department', 'Choose a department.');
  }
  if (locationId && !(await db.query('SELECT 1 FROM locations WHERE id = $1 AND business_id = $2', [locationId, req.member.businessId])).rows[0]) {
    throw badRequest('invalid_location', 'Choose a location.');
  }
}

// ---------- shifts ----------

export async function listShifts(app, req, { from, to, membershipId, departmentId, mine, open }) {
  assertRange(from, to, 120);
  const biz = await business(req);
  const params = [req.member.businessId, from, to, biz.timezone];
  const where = [
    's.business_id = $1',
    's.starts_at >= ($2::date)::timestamp AT TIME ZONE $4',
    's.starts_at < (($3::date) + 1)::timestamp AT TIME ZONE $4',
  ];
  const manager = can(req, 'schedules.view') && !mine;
  if (manager) {
    const scope = await managedScope(req);
    if (scope) {
      const cond = scopeSql(scope, params);
      where.push(`(s.membership_id IS NULL OR ${cond} OR s.department_id = ANY($${params.length - 1}::uuid[]))`);
    }
    if (membershipId) { params.push(membershipId); where.push(`s.membership_id = $${params.length}`); }
    if (departmentId) { params.push(departmentId); where.push(`s.department_id = $${params.length}`); }
  } else {
    // Employees see their own published shifts, plus open ones they could pick up.
    params.push(req.member.id);
    where.push(`s.published AND (s.membership_id = $${params.length}${open ? ' OR (s.membership_id IS NULL AND s.status = \'scheduled\')' : ''})`);
  }
  const { rows } = await app.db.query(`${SHIFT_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.starts_at LIMIT 2000`, params);
  return rows.map(shiftOut);
}

export async function getShift(app, req, id) {
  const { rows: [s] } = await app.db.query(`${SHIFT_SELECT} WHERE s.id = $1 AND s.business_id = $2`, [id, req.member.businessId]);
  if (!s) throw notFound();
  const mineOrOpen = s.membership_id === req.member.id || (s.membership_id === null && s.published);
  if (!mineOrOpen && !(can(req, 'schedules.view') && (!s.membership_id || (await inScope(req, s.membership_id))))) throw notFound();
  const { rows: hist } = await app.db.query(
    `SELECT h.id, h.change_type AS "changeType", h.before, h.after, h.reason, h.approval_status AS "approvalStatus",
            h.request_type AS "requestType", h.request_id AS "requestId", h.created_at AS "createdAt", u.name AS "changedBy"
       FROM shift_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.shift_id = $1 ORDER BY h.id`, [id]);
  return { ...shiftOut(s), history: hist };
}

export async function createShift(app, req, input) {
  const biz = await business(req);
  return transaction(app.db, async (db) => {
    await ensureRefs(db, req, input);
    await lockMember(db, input.membershipId);
    if (input.membershipId) await assertSchedulable(db, biz, input);
    const { rows: [s] } = await db.query(
      `INSERT INTO shifts (business_id, membership_id, department_id, location_id, starts_at, ends_at, break_minutes, notes, published, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.member.businessId, input.membershipId ?? null, input.departmentId ?? null, input.locationId ?? null, input.startsAt, input.endsAt,
        input.breakMinutes ?? 0, input.notes ?? null, !!input.published, req.auth.user.id]);
    await shiftHistory(db, req, s.id, 'created', null, snap(s));
    if (s.published && s.membership_id) await notifyMember(db, biz.id, s.membership_id, 'shift.assigned', { shiftId: s.id, startsAt: s.starts_at, endsAt: s.ends_at });
    return shiftOut(s);
  });
}

export async function updateShift(app, req, id, input) {
  const biz = await business(req);
  return transaction(app.db, async (db) => {
    const { rows: [s] } = await db.query('SELECT * FROM shifts WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
    if (!s) throw notFound();
    if (s.membership_id && !(await inScope(req, s.membership_id))) throw forbidden();
    if (s.status !== 'scheduled') throw conflict('shift_closed', 'Only scheduled shifts can be changed.');
    const next = {
      membershipId: input.membershipId !== undefined ? input.membershipId : s.membership_id,
      startsAt: input.startsAt ?? s.starts_at, endsAt: input.endsAt ?? s.ends_at,
      breakMinutes: input.breakMinutes ?? s.break_minutes,
      departmentId: input.departmentId !== undefined ? input.departmentId : s.department_id,
      locationId: input.locationId !== undefined ? input.locationId : s.location_id,
    };
    if (new Date(next.endsAt) <= new Date(next.startsAt)) throw badRequest('invalid_times', 'The shift must end after it starts.');
    await ensureRefs(db, req, next);
    await lockMember(db, next.membershipId);
    if (next.membershipId) await assertSchedulable(db, biz, { ...next, exclude: [id] });
    const { rows: [u] } = await db.query(
      `UPDATE shifts SET membership_id = $2, starts_at = $3, ends_at = $4, break_minutes = $5, department_id = $6, location_id = $7,
         notes = coalesce($8, notes), published = coalesce($9, published), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, next.membershipId, next.startsAt, next.endsAt, next.breakMinutes, next.departmentId, next.locationId, input.notes ?? null, input.published ?? null]);
    const type = s.membership_id !== u.membership_id ? 'reassigned' : 'updated';
    await shiftHistory(db, req, id, type, snap(s), snap(u), { reason: input.reason });
    if (u.published) {
      if (s.membership_id && s.membership_id !== u.membership_id) await notifyMember(db, biz.id, s.membership_id, 'shift.cancelled', { shiftId: id, startsAt: s.starts_at });
      if (u.membership_id) await notifyMember(db, biz.id, u.membership_id, s.membership_id === u.membership_id ? 'shift.changed' : 'shift.assigned', { shiftId: id, startsAt: u.starts_at, endsAt: u.ends_at });
    }
    return shiftOut(u);
  });
}

export async function cancelShift(app, req, id, reason) {
  return transaction(app.db, async (db) => {
    const { rows: [s] } = await db.query('SELECT * FROM shifts WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
    if (!s) throw notFound();
    if (s.membership_id && !(await inScope(req, s.membership_id))) throw forbidden();
    if (s.status !== 'scheduled') throw conflict('shift_closed', 'Only scheduled shifts can be cancelled.');
    await db.query('UPDATE shifts SET status = \'cancelled\', updated_at = now() WHERE id = $1', [id]);
    await shiftHistory(db, req, id, 'cancelled', snap(s), { ...snap(s), status: 'cancelled' }, { reason });
    if (s.published && s.membership_id) await notifyMember(db, req.member.businessId, s.membership_id, 'shift.cancelled', { shiftId: id, startsAt: s.starts_at });
  });
}

// Publishes draft shifts in a range and tells each person once.
export async function publish(app, req, { from, to }) {
  assertRange(from, to, 62);
  const biz = await business(req);
  return transaction(app.db, async (db) => {
    const params = [biz.id, from, to, biz.timezone];
    const scope = await managedScope(req);
    const cond = scope ? `AND (s.membership_id IS NULL OR s.membership_id IN (SELECT m.id FROM memberships m WHERE ${scopeSql(scope, params)}))` : '';
    const { rows } = await db.query(
      `UPDATE shifts s SET published = true, updated_at = now()
        WHERE s.business_id = $1 AND NOT s.published AND s.status = 'scheduled'
          AND s.starts_at >= ($2::date)::timestamp AT TIME ZONE $4 AND s.starts_at < (($3::date) + 1)::timestamp AT TIME ZONE $4 ${cond}
        RETURNING s.id, s.membership_id`, params);
    const people = new Map();
    for (const r of rows) {
      await shiftHistory(db, req, r.id, 'published', null, { published: true });
      if (r.membership_id) people.set(r.membership_id, (people.get(r.membership_id) || 0) + 1);
    }
    for (const [mid, n] of people) await notifyMember(db, biz.id, mid, 'schedule.published', { from, to, count: n });
    await auditB(db, req, { action: 'schedule.published', targetType: 'schedule', targetId: `${from}..${to}`, after: { shifts: rows.length } });
    return { published: rows.length, people: people.size };
  });
}

// Copies one week's shifts to another week as drafts; skips any that break the rules.
export async function copyWeek(app, req, { fromWeekStart, toWeekStart }) {
  const biz = await business(req);
  const days = Math.round((Date.parse(toWeekStart) - Date.parse(fromWeekStart)) / 86400000);
  if (!days || days % 7) throw badRequest('invalid_range', 'Choose two week start dates a whole number of weeks apart.');
  return transaction(app.db, async (db) => {
    const params = [biz.id, fromWeekStart, biz.timezone];
    const scope = await managedScope(req);
    const cond = scope ? `AND (s.membership_id IS NULL OR s.membership_id IN (SELECT m.id FROM memberships m WHERE ${scopeSql(scope, params)}))` : '';
    const { rows } = await db.query(
      `SELECT s.* FROM shifts s WHERE s.business_id = $1 AND s.status <> 'cancelled'
         AND s.starts_at >= ($2::date)::timestamp AT TIME ZONE $3 AND s.starts_at < (($2::date) + 7)::timestamp AT TIME ZONE $3 ${cond}`, params);
    let created = 0;
    const skipped = [];
    for (const s of rows) {
      const startsAt = new Date(new Date(s.starts_at).getTime() + days * 86400000);
      const endsAt = new Date(new Date(s.ends_at).getTime() + days * 86400000);
      if (s.membership_id) {
        await lockMember(db, s.membership_id);
        const problems = await scheduleProblems(db, biz, { membershipId: s.membership_id, startsAt, endsAt, breakMinutes: s.break_minutes });
        if (problems.length) { skipped.push({ shiftId: s.id, problems }); continue; }
      }
      const { rows: [n] } = await db.query(
        `INSERT INTO shifts (business_id, membership_id, department_id, location_id, starts_at, ends_at, break_minutes, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [biz.id, s.membership_id, s.department_id, s.location_id, startsAt, endsAt, s.break_minutes, s.notes, req.auth.user.id]);
      await shiftHistory(db, req, n.id, 'created', null, snap(n), { reason: 'Copied from previous week' });
      created++;
    }
    return { created, skipped };
  });
}

// ---------- unavailability ----------

export async function listUnavailability(app, req, membershipId) {
  const id = membershipId || req.member.id;
  if (id !== req.member.id && !(can(req, 'schedules.view') && (await inScope(req, id)))) throw forbidden();
  const { rows } = await app.db.query(
    `SELECT id, starts_at AS "startsAt", ends_at AS "endsAt", reason FROM unavailability
      WHERE membership_id = $1 AND business_id = $2 AND ends_at > now() - interval '30 days' ORDER BY starts_at`, [id, req.member.businessId]);
  return rows;
}

export async function addUnavailability(app, req, { membershipId, startsAt, endsAt, reason }) {
  const id = membershipId || req.member.id;
  if (id !== req.member.id && !(can(req, 'schedules.manage') && (await inScope(req, id)))) throw forbidden();
  if (new Date(endsAt) <= new Date(startsAt)) throw badRequest('invalid_times', 'The end must be after the start.');
  const { rows: [r] } = await app.db.query(
    'INSERT INTO unavailability (business_id, membership_id, starts_at, ends_at, reason) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.member.businessId, id, startsAt, endsAt, reason ?? null]);
  return { id: r.id };
}

export async function removeUnavailability(app, req, uid) {
  const { rows: [u] } = await app.db.query('SELECT * FROM unavailability WHERE id = $1 AND business_id = $2', [uid, req.member.businessId]);
  if (!u) throw notFound();
  if (u.membership_id !== req.member.id && !(can(req, 'schedules.manage') && (await inScope(req, u.membership_id)))) throw forbidden();
  await app.db.query('DELETE FROM unavailability WHERE id = $1', [uid]);
}

// ---------- dashboards ----------

// Employee view: today, next shift, this week, hours, open requests (spec §3).
export async function myWeek(app, req) {
  const biz = await business(req);
  const k = weekShift(biz.settings.payroll.weekStartsOn);
  const db = app.db;
  const { rows: [w] } = await db.query(
    'SELECT (date_trunc(\'week\', (now() AT TIME ZONE $1) + make_interval(days => $2)) - make_interval(days => $2)) AS ws', [biz.timezone, k]);
  const params = [req.member.id, w.ws, biz.timezone];
  const { rows: shifts } = await db.query(
    `${SHIFT_SELECT} WHERE s.membership_id = $1 AND s.published
       AND s.starts_at >= ($2::timestamp AT TIME ZONE $3) AND s.starts_at < (($2::timestamp + interval '7 days') AT TIME ZONE $3)
     ORDER BY s.starts_at`, params);
  const { rows: [next] } = await db.query(
    `${SHIFT_SELECT} WHERE s.membership_id = $1 AND s.published AND s.status = 'scheduled' AND s.ends_at > now() ORDER BY s.starts_at LIMIT 1`, [req.member.id]);
  const { rows: [worked] } = await db.query(
    `SELECT coalesce(sum(extract(epoch FROM (coalesce(clock_out, now()) - clock_in)) / 3600 - break_minutes / 60.0), 0)::float AS hours
       FROM attendance WHERE membership_id = $1 AND clock_in >= ($2::timestamp AT TIME ZONE $3)`, params);
  const { rows: [open] } = await db.query('SELECT id, clock_in, shift_id FROM attendance WHERE membership_id = $1 AND clock_out IS NULL', [req.member.id]);
  const { rows: reqs } = await db.query(
    'SELECT status, count(*)::int AS n FROM shift_requests WHERE membership_id = $1 AND created_at > now() - interval \'60 days\' GROUP BY status', [req.member.id]);
  const { rows: swaps } = await db.query(
    `SELECT count(*) FILTER (WHERE status IN ('pending_peer', 'pending_approval'))::int AS pending,
            count(*) FILTER (WHERE status = 'pending_peer' AND target_membership_id = $1)::int AS waiting_on_me,
            count(*) FILTER (WHERE status = 'approved')::int AS approved
       FROM shift_swaps WHERE (requester_membership_id = $1 OR target_membership_id = $1) AND created_at > now() - interval '60 days'`, [req.member.id]);
  const list = shifts.map(shiftOut);
  const nowMs = Date.now();
  // "Today" is the business's local date, not the server's.
  const localDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: biz.timezone }).format(new Date(d));
  const todayKey = localDay(nowMs);
  const today = list.filter((s) => s.status !== 'cancelled' && (localDay(s.startsAt) === todayKey || (new Date(s.startsAt) <= nowMs && new Date(s.endsAt) > nowMs)));
  const reqCount = Object.fromEntries(reqs.map((r) => [r.status, r.n]));
  return {
    weekStart: w.ws,
    today: [...new Map(today.map((s) => [s.id, s])).values()],
    next: next ? shiftOut(next) : null,
    shifts: list,
    scheduledHours: list.filter((s) => s.status !== 'cancelled').reduce((a, s) => a + s.hours, 0),
    completedShifts: list.filter((s) => s.status === 'completed' || (s.status === 'scheduled' && new Date(s.endsAt) < nowMs)).length,
    rescheduledShifts: list.filter((s) => s.rescheduled).length,
    workedHours: Math.round(worked.hours * 100) / 100,
    clockedIn: open ? { attendanceId: open.id, since: open.clock_in, shiftId: open.shift_id } : null,
    requests: { pending: reqCount.pending || 0, approved: reqCount.approved || 0, rejected: reqCount.rejected || 0 },
    swaps: swaps[0],
  };
}

// Manager view of today: who is working, who is late or missing (spec §23).
export async function todayStaffing(app, req) {
  const biz = await business(req);
  const params = [biz.id, biz.timezone];
  const scope = await managedScope(req);
  const cond = scope ? `AND (s.membership_id IS NULL OR ${scopeSql(scope, params)})` : '';
  const { rows } = await app.db.query(
    `SELECT s.*, u.name AS member_name, d.name AS department_name, NULL AS location_name, false AS rescheduled,
            a.clock_in, a.clock_out
       FROM shifts s LEFT JOIN memberships m ON m.id = s.membership_id LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN departments d ON d.id = s.department_id
       LEFT JOIN LATERAL (SELECT clock_in, clock_out FROM attendance at WHERE at.membership_id = s.membership_id
                            AND at.clock_in < s.ends_at AND coalesce(at.clock_out, now()) > s.starts_at - interval '2 hours'
                          ORDER BY at.clock_in DESC LIMIT 1) a ON true
      WHERE s.business_id = $1 AND s.status <> 'cancelled'
        AND s.starts_at < ((now() AT TIME ZONE $2)::date + 1)::timestamp AT TIME ZONE $2
        AND s.ends_at > ((now() AT TIME ZONE $2)::date)::timestamp AT TIME ZONE $2 ${cond}
      ORDER BY s.starts_at`, params);
  const now = Date.now();
  const items = rows.map((r) => {
    const s = shiftOut(r);
    let state = 'upcoming';
    if (!r.membership_id) state = 'open';
    else if (r.clock_in && !r.clock_out) state = 'working';
    else if (r.clock_out) state = 'done';
    else if (new Date(r.ends_at) < now) state = 'missed';
    else if (new Date(r.starts_at).getTime() + 10 * 60000 < now) state = 'late';
    return { ...s, state, clockIn: r.clock_in, clockOut: r.clock_out };
  });
  const count = (st) => items.filter((i) => i.state === st).length;
  return {
    shifts: items,
    totals: { scheduled: items.filter((i) => i.membershipId).length, working: count('working'), late: count('late'), missed: count('missed'), open: count('open'), done: count('done') },
  };
}
