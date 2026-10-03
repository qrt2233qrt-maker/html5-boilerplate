import { loadPermissions } from '../auth/permissions.js';
import { queueMessage } from '../messaging/outbox.js';
import { SMS_TYPES, noticeTitle } from '../messaging/notices.js';

let appUrl = '';
export const configureNotify = (opts) => { appUrl = opts.appUrl; };

// In-app notification, plus email/SMS copies according to the person's
// preferences for this business (spec §22).
export async function notify(db, { businessId = null, userId, type, data = {} }) {
  if (!userId) return;
  await db.query('INSERT INTO notifications (business_id, user_id, type, data) VALUES ($1, $2, $3, $4)', [businessId, userId, type, JSON.stringify(data)]);
  const { rows: [u] } = await db.query(
    `SELECT u.email, u.phone, u.email_verified_at, u.phone_verified_at, u.locale, b.locale AS business_locale, b.name AS business_name, m.notification_prefs AS prefs
       FROM users u LEFT JOIN memberships m ON m.user_id = u.id AND m.business_id = $2 LEFT JOIN businesses b ON b.id = $2
      WHERE u.id = $1`, [userId, businessId]);
  if (!u || !u.prefs) return;
  const locale = u.locale || u.business_locale || 'ar';
  const title = noticeTitle(type, locale, data);
  if (!title) return;
  const link = `${appUrl}/#/notifications`;
  if (u.prefs.email && u.email && u.email_verified_at) {
    await queueMessage(db, { channel: 'email', to: u.email, subject: `${u.business_name}: ${title}`, body: `${title}\n\n${link}` });
  }
  if (u.prefs.sms && u.phone && u.phone_verified_at && SMS_TYPES.has(type)) {
    await queueMessage(db, { channel: 'sms', to: u.phone, body: `${u.business_name}: ${title}` });
  }
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
