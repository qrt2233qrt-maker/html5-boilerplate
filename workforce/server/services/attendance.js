// Clock in/out, manager corrections (with history), and missed shifts.
import { transaction } from '../db/pool.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertRange, auditB, business, history, inScope, managedScope, scopeSql } from '../lib/context.js';
import { can } from '../auth/session.js';
import { distanceM, doorCodeValid } from '../lib/geo.js';
import { normalizeCode } from '../lib/identity.js';

const out = (r) => ({
  id: r.id, membershipId: r.membership_id, memberName: r.member_name ?? null, shiftId: r.shift_id,
  locationId: r.location_id ?? null, locationName: r.location_name ?? null,
  inDistanceM: r.in_distance_m === null || r.in_distance_m === undefined ? null : Math.round(r.in_distance_m),
  outDistanceM: r.out_distance_m === null || r.out_distance_m === undefined ? null : Math.round(r.out_distance_m),
  shiftStartsAt: r.shift_starts_at ?? null, shiftEndsAt: r.shift_ends_at ?? null,
  clockIn: r.clock_in, clockOut: r.clock_out, breakMinutes: r.break_minutes, source: r.source, note: r.note,
  hours: r.clock_out ? Math.max(0, (new Date(r.clock_out) - new Date(r.clock_in)) / 3600000 - r.break_minutes / 60) : null,
  lateMinutes: r.shift_starts_at ? Math.max(0, Math.round((new Date(r.clock_in) - new Date(r.shift_starts_at)) / 60000)) : null,
});

const SELECT = `SELECT a.*, u.name AS member_name, s.starts_at AS shift_starts_at, s.ends_at AS shift_ends_at, l.name AS location_name
  FROM attendance a JOIN memberships m ON m.id = a.membership_id JOIN users u ON u.id = m.user_id
  LEFT JOIN shifts s ON s.id = a.shift_id LEFT JOIN locations l ON l.id = a.location_id`;

// ---------- clock-in zone ----------

// GPS readings worse than this can't tell inside from 500 m away.
const MAX_ACCURACY_M = 150;

// Whether this business requires clocking in at the door: the setting is
// on and at least one location has its position set.
export async function zoneRequired(db, biz) {
  if (!biz.settings.attendance.requireZone) return false;
  const { rowCount } = await db.query('SELECT 1 FROM locations WHERE business_id = $1 AND archived_at IS NULL AND latitude IS NOT NULL LIMIT 1', [biz.id]);
  return rowCount > 0;
}

// How people prove they're at work (settings.attendance.method):
//   'qr'     scan the code at the door (plus the phone's position when
//            checkLocation is on),
//   'gps'    no scan: the phone must be inside a location's radius,
//   'either' whichever the person does.
export const clockMethod = (biz) => (['qr', 'gps', 'either'].includes(biz.settings.attendance.method) ? biz.settings.attendance.method : 'qr');

// Rejects readings too rough to tell inside from far away.
function checkAccuracy(accuracy) {
  if (typeof accuracy === 'number' && accuracy > MAX_ACCURACY_M) {
    throw badRequest('location_inaccurate', 'Your phone can\'t tell precisely where you are. Turn on precise location and try again.', { accuracy: Math.round(accuracy) });
  }
}

// A little allowance for GPS error, but never more than 30 m.
const allowanceFor = (accuracy) => Math.min(typeof accuracy === 'number' ? accuracy : 30, 30);

const outside = (loc, distance) => new AppError(403, 'outside_zone', `You're about ${Math.round(distance)} m from ${loc.name}. Clock in once you're within ${loc.radius_m} m.`,
  { distance: Math.round(distance), radius: loc.radius_m, location: loc.name });

// Checks the door code (and the phone's position when asked).
async function checkDoor(db, biz, { locationId, code, lat, lng, accuracy }) {
  const { rows: [loc] } = await db.query(
    'SELECT * FROM locations WHERE id = $1 AND business_id = $2 AND archived_at IS NULL', [locationId, biz.id]);
  if (!loc) throw badRequest('zone_required', 'Scan the QR code at the door to clock in or out.');
  if (!doorCodeValid(loc, biz.timezone, normalizeCode(code))) {
    throw badRequest('invalid_door_code', 'That code has changed. Scan the code at the door again.');
  }
  const noPosition = { locationId: loc.id, lat: null, lng: null, accuracy: null, distance: null };
  // Scanning alone is enough unless the owner also wants the position checked.
  if (loc.latitude === null || biz.settings.attendance.checkLocation === false || clockMethod(biz) === 'either') return noPosition;
  if (typeof lat !== 'number' || typeof lng !== 'number') throw badRequest('location_needed', 'Allow location for this app, then try again.');
  checkAccuracy(accuracy);
  const distance = distanceM(lat, lng, loc.latitude, loc.longitude);
  if (distance > loc.radius_m + allowanceFor(accuracy)) throw outside(loc, distance);
  return { locationId: loc.id, lat, lng, accuracy: typeof accuracy === 'number' ? accuracy : null, distance };
}

// No scan: the phone's position must be inside the nearest location's radius.
async function checkGps(db, biz, { lat, lng, accuracy }) {
  if (typeof lat !== 'number' || typeof lng !== 'number') throw badRequest('location_needed', 'Allow location for this app, then try again.');
  checkAccuracy(accuracy);
  const { rows } = await db.query(
    'SELECT * FROM locations WHERE business_id = $1 AND archived_at IS NULL AND latitude IS NOT NULL', [biz.id]);
  let best = null;
  for (const loc of rows) {
    const distance = distanceM(lat, lng, loc.latitude, loc.longitude);
    if (!best || distance - loc.radius_m < best.distance - best.loc.radius_m) best = { loc, distance };
  }
  if (!best) throw badRequest('zone_required', 'The restaurant\'s position isn\'t set yet. Ask a manager.');
  if (best.distance > best.loc.radius_m + allowanceFor(accuracy)) throw outside(best.loc, best.distance);
  return { locationId: best.loc.id, lat, lng, accuracy: typeof accuracy === 'number' ? accuracy : null, distance: best.distance };
}

// Checks the door code or the phone's position; returns what to record.
async function checkZone(db, biz, where) {
  if (!(await zoneRequired(db, biz))) return null;
  const method = clockMethod(biz);
  if (method !== 'gps' && where.locationId && where.code) return checkDoor(db, biz, where);
  if (method !== 'qr') return checkGps(db, biz, where);
  throw badRequest('zone_required', 'Scan the QR code at the door to clock in or out.');
}

// The shift this clock-in belongs to: one running now or starting within 2 hours.
async function currentShift(db, membershipId) {
  const { rows: [s] } = await db.query(
    `SELECT id, ends_at FROM shifts WHERE membership_id = $1 AND status = 'scheduled'
       AND starts_at - interval '2 hours' <= now() AND ends_at > now() ORDER BY starts_at LIMIT 1`, [membershipId]);
  return s || null;
}

export async function clockIn(app, req, { note, ...where } = {}) {
  const biz = await business(req);
  return transaction(app.db, async (db) => {
    await db.query('SELECT 1 FROM memberships WHERE id = $1 FOR UPDATE', [req.member.id]);
    const open = await db.query('SELECT 1 FROM attendance WHERE membership_id = $1 AND clock_out IS NULL', [req.member.id]);
    if (open.rows[0]) throw conflict('already_clocked_in', 'You are already clocked in.');
    const zone = await checkZone(db, biz, where);
    const shift = await currentShift(db, req.member.id);
    const { rows: [a] } = await db.query(
      `INSERT INTO attendance (business_id, membership_id, shift_id, clock_in, note, location_id, in_lat, in_lng, in_accuracy_m, in_distance_m)
       VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.member.businessId, req.member.id, shift?.id ?? null, note ?? null, zone?.locationId ?? null, zone?.lat ?? null, zone?.lng ?? null, zone?.accuracy ?? null, zone?.distance ?? null]);
    await auditB(db, req, { action: 'attendance.clock_in', targetType: 'attendance', targetId: a.id, after: zone ? { distanceM: zone.distance === null ? null : Math.round(zone.distance) } : null });
    return out(a);
  });
}

export async function clockOut(app, req, { breakMinutes = 0, note, ...where } = {}) {
  const biz = await business(req);
  return transaction(app.db, async (db) => {
    const { rows: [a] } = await db.query('SELECT * FROM attendance WHERE membership_id = $1 AND clock_out IS NULL FOR UPDATE', [req.member.id]);
    if (!a) throw conflict('not_clocked_in', 'You are not clocked in.');
    const minutes = (Date.now() - new Date(a.clock_in)) / 60000;
    if (breakMinutes >= minutes) throw badRequest('invalid_break', 'The break is longer than the time worked.');
    const zone = await checkZone(db, biz, where);
    const { rows: [u] } = await db.query(
      `UPDATE attendance SET clock_out = now(), break_minutes = $2, note = coalesce($3, note), updated_at = now(),
              location_id = coalesce(location_id, $4), out_lat = $5, out_lng = $6, out_accuracy_m = $7, out_distance_m = $8
        WHERE id = $1 RETURNING *`,
      [a.id, breakMinutes, note ?? null, zone?.locationId ?? null, zone?.lat ?? null, zone?.lng ?? null, zone?.accuracy ?? null, zone?.distance ?? null]);
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
    if (await locked(db, { membership_id: membershipId, clock_in: clockIn })) {
      throw conflict('period_locked', 'This day is already paid and can\'t be changed. Add an adjustment to the next payroll instead.');
    }
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

// Attendance on a day this person has already been paid for is part of the books.
async function locked(db, a) {
  const { rows } = await db.query(
    `SELECT 1 FROM payroll_statements s JOIN payroll_runs r ON r.id = s.run_id JOIN businesses b ON b.id = r.business_id
      WHERE s.membership_id = $1 AND (r.status = 'paid' OR s.status = 'paid')
        AND ($2::timestamptz AT TIME ZONE b.timezone)::date = ANY(s.days)`, [a.membership_id, a.clock_in]);
  return !!rows[0];
}

// Shared with delivery trips: has this person been paid for this day?
export async function dayPaid(db, membershipId, day) {
  const { rows } = await db.query(
    `SELECT 1 FROM payroll_statements s JOIN payroll_runs r ON r.id = s.run_id
      WHERE s.membership_id = $1 AND (r.status = 'paid' OR s.status = 'paid') AND $2::date = ANY(s.days)`, [membershipId, day]);
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
