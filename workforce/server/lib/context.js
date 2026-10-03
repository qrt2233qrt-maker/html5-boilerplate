import { audit } from './audit.js';
import { badRequest } from './errors.js';

// Settings every business starts with. Stored overrides are merged on top.
export const DEFAULT_SETTINGS = {
  auth: { requirePhoneVerification: false },
  scheduling: { maxWeeklyHours: 48, maxShiftHours: 12, minRestHours: 8 },
  payroll: { frequency: 'monthly', weekStartsOn: 6, overtimeWeeklyHours: 48, overtimeMultiplier: 1.5 },
  approvals: { expenseOwnerOver: 250000 },
  // Clock in/out only by scanning the door QR once a location has its
  // position; checkLocation also checks the phone is inside the radius;
  // typedCode lets people type the code under the QR instead of scanning.
  attendance: { requireZone: true, checkLocation: true, typedCode: false },
  alerts: { payrollIncreasePct: 15, categoryIncreasePct: 25, revenueDropPct: 10, overtimeIncreasePct: 20, marginBelowPct: 10, largeExpense: 1000000 },
};

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

export const settingsOf = (business) => merge(DEFAULT_SETTINGS, business?.settings || {});

// Loads the business row the request is scoped to (cached per request).
export async function business(req) {
  if (!req._business) {
    const { rows: [b] } = await req.server.db.query('SELECT * FROM businesses WHERE id = $1', [req.member.businessId]);
    b.settings = settingsOf(b);
    req._business = b;
  }
  return req._business;
}

// History row for financial and scheduling records (append-only table).
export async function history(db, req, entityType, entityId, changeType, before, after, reason = null) {
  await db.query(
    `INSERT INTO record_history (business_id, entity_type, entity_id, change_type, before, after, reason, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [req.member.businessId, entityType, entityId, changeType, before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null, reason, req.auth.user.id]);
}

export const auditB = (db, req, entry) => audit(db, req, { businessId: req.member.businessId, ...entry });

// Runs fn once per Idempotency-Key header; a retry returns the stored result.
export async function idempotent(req, fn) {
  const key = req.headers['idempotency-key'];
  if (!key) return fn();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw badRequest('invalid_idempotency_key', 'Invalid Idempotency-Key header.');
  const db = req.server.db;
  const found = await db.query('SELECT response FROM idempotency_keys WHERE business_id = $1 AND user_id = $2 AND key = $3',
    [req.member.businessId, req.auth.user.id, key]);
  if (found.rows[0]) return found.rows[0].response;
  const result = await fn();
  await db.query(
    `INSERT INTO idempotency_keys (business_id, user_id, key, response) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`, [req.member.businessId, req.auth.user.id, key, JSON.stringify(result ?? null)]);
  return result;
}

// Which members a manager may manage. null = everyone. A manager who runs one
// or more departments sees those departments plus their direct reports.
export async function managedScope(req) {
  if (req.member.role === 'owner') return null;
  if (req._scope !== undefined) return req._scope;
  const { rows } = await req.server.db.query(
    'SELECT id FROM departments WHERE business_id = $1 AND manager_membership_id = $2 AND archived_at IS NULL',
    [req.member.businessId, req.member.id]);
  req._scope = rows.length ? { departmentIds: rows.map((r) => r.id), managerId: req.member.id } : null;
  return req._scope;
}

// SQL condition limiting memberships alias `m` to the manager's scope.
// Pushes its parameters onto `params` and returns the condition text.
export function scopeSql(scope, params, alias = 'm') {
  if (!scope) return 'TRUE';
  params.push(scope.departmentIds, scope.managerId);
  // Their own departments, their direct reports, themselves, and anyone
  // (except the owner) in a department nobody manages or in no department:
  // otherwise those people would be invisible to every manager.
  return `(${alias}.department_id = ANY($${params.length - 1}::uuid[]) OR ${alias}.reports_to = $${params.length} OR ${alias}.id = $${params.length}
    OR (${alias}.role <> 'owner' AND NOT EXISTS (SELECT 1 FROM departments sd WHERE sd.id = ${alias}.department_id AND sd.manager_membership_id IS NOT NULL AND sd.archived_at IS NULL)))`;
}

export async function inScope(req, membershipId) {
  const scope = await managedScope(req);
  if (!scope) return true;
  const params = [membershipId, req.member.businessId];
  const cond = scopeSql(scope, params);
  const { rows } = await req.server.db.query(`SELECT 1 FROM memberships m WHERE m.id = $1 AND m.business_id = $2 AND ${cond}`, params);
  return !!rows[0];
}

export function assertRange(from, to, maxDays = 1100) {
  if (!from || !to) throw badRequest('range_required', 'Choose a start and end date.');
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (Number.isNaN(days) || days < 0) throw badRequest('invalid_range', 'The end date must be on or after the start date.');
  if (days > maxDays) throw badRequest('range_too_long', 'Choose a shorter date range.');
}
