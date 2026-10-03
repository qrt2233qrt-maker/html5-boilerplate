// Notification centre (spec §22): list, unread count, read, preferences.
import { notFound } from '../lib/errors.js';

export async function listNotifications(app, req, { before, limit = 30, unread }) {
  const params = [req.auth.user.id, req.member.businessId];
  const where = ['n.user_id = $1', '(n.business_id = $2 OR n.business_id IS NULL)'];
  if (before) { params.push(before); where.push(`n.created_at < $${params.length}`); }
  if (unread) where.push('n.read_at IS NULL');
  params.push(Math.min(limit, 100));
  const { rows } = await app.db.query(
    `SELECT n.id, n.type, n.data, n.read_at AS "readAt", n.created_at AS "createdAt" FROM notifications n
      WHERE ${where.join(' AND ')} ORDER BY n.created_at DESC LIMIT $${params.length}`, params);
  const { rows: [c] } = await app.db.query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND (business_id = $2 OR business_id IS NULL) AND read_at IS NULL', [req.auth.user.id, req.member.businessId]);
  return { items: rows, unread: c.n, nextBefore: rows.length === params.at(-1) ? rows.at(-1).createdAt : null };
}

export async function markRead(app, req, id) {
  const { rowCount } = await app.db.query('UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2', [id, req.auth.user.id]);
  if (!rowCount) throw notFound();
}

export async function markAllRead(app, req) {
  await app.db.query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND (business_id = $2 OR business_id IS NULL) AND read_at IS NULL', [req.auth.user.id, req.member.businessId]);
}

export async function getPrefs(app, req) {
  const { rows: [m] } = await app.db.query('SELECT notification_prefs FROM memberships WHERE id = $1', [req.member.id]);
  return m.notification_prefs;
}

export async function setPrefs(app, req, prefs) {
  const { rows: [m] } = await app.db.query(
    'UPDATE memberships SET notification_prefs = notification_prefs || $2::jsonb, updated_at = now() WHERE id = $1 RETURNING notification_prefs',
    [req.member.id, JSON.stringify(prefs)]);
  return m.notification_prefs;
}
