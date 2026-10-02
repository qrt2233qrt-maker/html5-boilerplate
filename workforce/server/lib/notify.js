import { loadPermissions } from '../auth/permissions.js';

// In-app notification. Email/SMS copies are sent by the notifications
// service according to each person's preferences (Phase 12).
export async function notify(db, { businessId = null, userId, type, data = {} }) {
  if (!userId) return;
  await db.query(
    'INSERT INTO notifications (business_id, user_id, type, data) VALUES ($1, $2, $3, $4)',
    [businessId, userId, type, JSON.stringify(data)]);
}

export async function notifyMember(db, businessId, membershipId, type, data = {}) {
  const { rows: [m] } = await db.query('SELECT user_id FROM memberships WHERE id = $1 AND business_id = $2', [membershipId, businessId]);
  if (m) await notify(db, { businessId, userId: m.user_id, type, data });
}

// Owners plus managers who hold `permission` and manage `membershipId`.
export async function approverUserIds(db, businessId, permission, membershipId = null) {
  const { rows } = await db.query(
    `SELECT m.*, EXISTS (SELECT 1 FROM departments d WHERE d.manager_membership_id = m.id AND d.archived_at IS NULL) AS runs_department
       FROM memberships m WHERE m.business_id = $1 AND m.status = 'active' AND m.role IN ('owner', 'manager')`, [businessId]);
  let target = null;
  if (membershipId) target = (await db.query('SELECT department_id, reports_to FROM memberships WHERE id = $1', [membershipId])).rows[0];
  const out = [];
  for (const m of rows) {
    if (m.id === membershipId) continue;
    if (m.role === 'manager') {
      if (!(await loadPermissions(db, m)).has(permission)) continue;
      if (m.runs_department && target) {
        const depts = (await db.query('SELECT id FROM departments WHERE manager_membership_id = $1 AND archived_at IS NULL', [m.id])).rows.map((r) => r.id);
        if (!depts.includes(target.department_id) && target.reports_to !== m.id) continue;
      }
    }
    out.push(m.user_id);
  }
  return out;
}

export async function notifyApprovers(db, businessId, permission, membershipId, type, data) {
  for (const userId of await approverUserIds(db, businessId, permission, membershipId)) {
    await notify(db, { businessId, userId, type, data });
  }
}
