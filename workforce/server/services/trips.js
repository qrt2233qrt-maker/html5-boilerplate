// Delivery trips: drivers are paid per trip, and a manager enters how many
// trips each driver made each day (spec addition for PizzaRita).
import { transaction } from '../db/pool.js';
import { badRequest, conflict, forbidden } from '../lib/errors.js';
import { assertRange, auditB, history, inScope, managedScope, scopeSql } from '../lib/context.js';
import { can } from '../auth/session.js';
import { dayPaid } from './attendance.js';

// Drivers: people whose pay on some day in the range is per trip.
export async function listTrips(app, req, { from, to, mine }) {
  assertRange(from, to, 120);
  const db = app.db;
  const self = mine || !can(req, 'attendance.view');
  const params = [req.member.businessId, from, to];
  let cond;
  if (self) { params.push(req.member.id); cond = `m.id = $${params.length}`; } else cond = scopeSql(await managedScope(req), params);
  const { rows: drivers } = await db.query(
    `SELECT m.id AS "membershipId", u.name, d.name AS "departmentName",
            (SELECT row_to_json(x) FROM (SELECT rate, frequency FROM pay_rates p WHERE p.membership_id = m.id AND p.effective_from <= $3
               ORDER BY effective_from DESC, created_at DESC LIMIT 1) x) AS pay
       FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN departments d ON d.id = m.department_id
      WHERE m.business_id = $1 AND m.status IN ('active', 'suspended', 'terminated') AND ${cond}
        AND EXISTS (SELECT 1 FROM pay_rates p WHERE p.membership_id = m.id AND p.pay_type = 'per_trip' AND p.effective_from <= $3)
        AND (m.end_date IS NULL OR m.end_date >= $2)
      ORDER BY u.name`, params);
  const ids = drivers.map((x) => x.membershipId);
  const { rows: entries } = await db.query(
    `SELECT t.membership_id AS "membershipId", t.day::text AS day, t.trips, t.note, t.updated_at AS "updatedAt",
            EXISTS (SELECT 1 FROM payroll_statements s JOIN payroll_runs r ON r.id = s.run_id
                     WHERE s.membership_id = t.membership_id AND (r.status = 'paid' OR s.status = 'paid') AND t.day = ANY(s.days)) AS paid
       FROM delivery_trips t WHERE t.membership_id = ANY($1::uuid[]) AND t.day BETWEEN $2 AND $3 ORDER BY t.day`, [ids, from, to]);
  return { drivers, entries };
}

// Saves the trip counts for one day (several drivers at once).
export async function saveTrips(app, req, { day, entries }) {
  return transaction(app.db, async (db) => {
    const saved = [];
    for (const e of entries) {
      if (!(await inScope(req, e.membershipId))) throw forbidden();
      const { rows: [driver] } = await db.query(
        `SELECT 1 FROM memberships m WHERE m.id = $1 AND m.business_id = $2
           AND EXISTS (SELECT 1 FROM pay_rates p WHERE p.membership_id = m.id AND p.pay_type = 'per_trip' AND p.effective_from <= $3)`,
        [e.membershipId, req.member.businessId, day]);
      if (!driver) throw badRequest('not_a_driver', 'Only people paid per trip have trips.');
      if (await dayPaid(db, e.membershipId, day)) {
        throw conflict('period_locked', 'This day is already paid and can\'t be changed. Add an adjustment to the next payroll instead.');
      }
      const { rows: [before] } = await db.query('SELECT * FROM delivery_trips WHERE membership_id = $1 AND day = $2', [e.membershipId, day]);
      if (before && before.trips === e.trips && (before.note ?? null) === (e.note ?? null)) continue;
      const { rows: [row] } = await db.query(
        `INSERT INTO delivery_trips (business_id, membership_id, day, trips, note, entered_by) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (membership_id, day) DO UPDATE SET trips = EXCLUDED.trips, note = EXCLUDED.note, entered_by = EXCLUDED.entered_by, updated_at = now()
         RETURNING *`, [req.member.businessId, e.membershipId, day, e.trips, e.note ?? null, req.auth.user.id]);
      await history(db, req, 'delivery_trips', row.id, before ? 'updated' : 'created', before ? { trips: before.trips, note: before.note } : null, { trips: row.trips, note: row.note });
      saved.push({ membershipId: e.membershipId, trips: row.trips });
    }
    if (saved.length) await auditB(db, req, { action: 'trips.saved', targetType: 'delivery_trips', targetId: null, after: { day, saved } });
    return { day, saved: saved.length };
  });
}
