// Team chat (everyone at the business) and private one-to-one chats.
// Private chats are visible only to the two people in them, the owner
// included. Messages are never edited; a sender can remove their own, and
// the owner can remove messages from the team chat.
import { transaction } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { auditB, inScope } from '../lib/context.js';
import { can } from '../auth/session.js';
import { rateLimit } from '../lib/rate-limit.js';

async function teamThread(db, businessId) {
  const { rows: [t] } = await db.query(
    `INSERT INTO chat_threads (business_id, kind) VALUES ($1, 'team')
     ON CONFLICT (business_id) WHERE kind = 'team' DO UPDATE SET kind = 'team' RETURNING *`, [businessId]);
  return t;
}

// The thread, if this person may read it.
async function thread(db, req, id) {
  const { rows: [t] } = await db.query('SELECT * FROM chat_threads WHERE id = $1 AND business_id = $2', [id, req.member.businessId]);
  if (!t) throw notFound();
  if (t.kind === 'direct' && t.member_a !== req.member.id && t.member_b !== req.member.id) throw notFound();
  return t;
}

const preview = (body) => (body.length > 90 ? `${body.slice(0, 89)}…` : body);

export async function listThreads(app, req) {
  const db = app.db;
  await teamThread(db, req.member.businessId);
  const me = req.member.id;
  const { rows } = await db.query(
    `SELECT t.id, t.kind, t.last_message_at,
            CASE WHEN t.kind = 'direct' THEN (CASE WHEN t.member_a = $2 THEN t.member_b ELSE t.member_a END) END AS other_id,
            ou.name AS other_name, om.status AS other_status, om.role AS other_role,
            lm.body AS last_body, lm.deleted_at AS last_deleted, lu.name AS last_sender, lm.sender_id AS last_sender_id, lm.created_at AS last_at,
            (SELECT count(*) FROM chat_messages x WHERE x.thread_id = t.id AND x.deleted_at IS NULL AND x.sender_id <> $2
               AND x.id > coalesce((SELECT last_read_id FROM chat_reads r WHERE r.thread_id = t.id AND r.membership_id = $2), 0))::int AS unread
       FROM chat_threads t
       LEFT JOIN memberships om ON om.id = CASE WHEN t.member_a = $2 THEN t.member_b ELSE t.member_a END
       LEFT JOIN users ou ON ou.id = om.user_id
       LEFT JOIN LATERAL (SELECT * FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) lm ON true
       LEFT JOIN memberships lsm ON lsm.id = lm.sender_id LEFT JOIN users lu ON lu.id = lsm.user_id
      WHERE t.business_id = $1 AND (t.kind = 'team' OR t.member_a = $2 OR t.member_b = $2)
      ORDER BY (t.kind = 'team') DESC, coalesce(t.last_message_at, t.created_at) DESC`, [req.member.businessId, me]);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, otherMembershipId: r.other_id, otherName: r.other_name, otherRole: r.other_role,
    otherActive: r.kind === 'direct' ? r.other_status === 'active' : true,
    lastMessage: r.last_at ? { body: r.last_deleted ? null : preview(r.last_body), sender: r.last_sender, mine: r.last_sender_id === me, at: r.last_at } : null,
    unread: r.unread,
  }));
}

export async function unreadCount(app, req) {
  const threads = await listThreads(app, req);
  return { unread: threads.reduce((a, t) => a + t.unread, 0) };
}

// Everyone active in the business, to start a private chat with.
export async function chatPeople(app, req) {
  const { rows } = await app.db.query(
    `SELECT m.id AS "membershipId", u.name, m.role, m.profile->>'jobTitle' AS "jobTitle", d.name AS "departmentName"
       FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN departments d ON d.id = m.department_id
      WHERE m.business_id = $1 AND m.status = 'active' AND m.id <> $2 ORDER BY (m.role = 'employee'), u.name`, [req.member.businessId, req.member.id]);
  return rows;
}

// Opens (creating if needed) the private chat with someone.
export async function openDirect(app, req, { membershipId }) {
  if (membershipId === req.member.id) throw badRequest('invalid_member', 'Choose someone else.');
  const { rows: [other] } = await app.db.query(
    'SELECT id FROM memberships WHERE id = $1 AND business_id = $2 AND status = \'active\'', [membershipId, req.member.businessId]);
  if (!other) throw badRequest('invalid_member', 'Choose someone from your team.');
  const [a, b] = [req.member.id, membershipId].sort();
  const { rows: [t] } = await app.db.query(
    `INSERT INTO chat_threads (business_id, kind, member_a, member_b) VALUES ($1, 'direct', $2, $3)
     ON CONFLICT (member_a, member_b) WHERE kind = 'direct' DO UPDATE SET kind = 'direct' RETURNING id`, [req.member.businessId, a, b]);
  return { id: t.id };
}

const messageOut = (m, me) => ({
  id: Number(m.id), senderId: m.sender_id, senderName: m.sender_name, mine: m.sender_id === me,
  body: m.deleted_at ? null : m.body, deleted: !!m.deleted_at, createdAt: m.created_at,
  ref: m.ref_type ? {
    type: m.ref_type, id: m.ref_id, requestType: m.ref_kind ?? null, status: m.ref_status ?? null,
    startsAt: m.ref_starts ?? null, endsAt: m.ref_ends ?? null,
  } : null,
});

// A page of messages, newest last. `after` fetches only newer ones (polling).
export async function messages(app, req, id, { before, after, limit = 50 }) {
  const db = app.db;
  const t = await thread(db, req, id);
  const params = [t.id];
  let cond = '';
  if (after) { params.push(after); cond = `AND m.id > $${params.length}`; } else if (before) { params.push(before); cond = `AND m.id < $${params.length}`; }
  params.push(Math.min(limit, 100));
  const { rows } = await db.query(
    `SELECT m.*, u.name AS sender_name, r.type AS ref_kind, r.status AS ref_status,
            coalesce(r.requested_starts_at, s.starts_at) AS ref_starts, coalesce(r.requested_ends_at, s.ends_at) AS ref_ends
       FROM chat_messages m JOIN memberships sm ON sm.id = m.sender_id JOIN users u ON u.id = sm.user_id
       LEFT JOIN shift_requests r ON m.ref_type = 'shift_request' AND r.id = m.ref_id
       LEFT JOIN shifts s ON s.id = r.shift_id
      WHERE m.thread_id = $1 ${cond} ORDER BY m.id DESC LIMIT $${params.length}`, params);
  const list = rows.reverse().map((m) => messageOut(m, req.member.id));
  // Reading marks the thread read up to the newest message seen.
  const newest = list.length ? list[list.length - 1].id : 0;
  if (newest) {
    await db.query(
      `INSERT INTO chat_reads (thread_id, membership_id, last_read_id) VALUES ($1, $2, $3)
       ON CONFLICT (thread_id, membership_id) DO UPDATE SET last_read_id = greatest(chat_reads.last_read_id, EXCLUDED.last_read_id)`,
      [t.id, req.member.id, newest]);
  }
  let other = null;
  if (t.kind === 'direct') {
    const otherId = t.member_a === req.member.id ? t.member_b : t.member_a;
    const { rows: [o] } = await db.query('SELECT m.id, u.name, m.status, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.id = $1', [otherId]);
    other = { membershipId: o.id, name: o.name, active: o.status === 'active', role: o.role };
  }
  return { thread: { id: t.id, kind: t.kind, other }, messages: list, more: !after && rows.length === Math.min(limit, 100) };
}

export async function send(app, req, id, { body, refType, refId }) {
  const text = String(body || '').trim();
  if (!text) throw badRequest('empty_message', 'Write a message first.');
  // A burst limit that never bothers a person typing, only a script.
  await rateLimit(app.db, `chat:${req.member.id}`, 30, 60);
  return transaction(app.db, async (db) => {
    const t = await thread(db, req, id);
    if (t.kind === 'direct') {
      const otherId = t.member_a === req.member.id ? t.member_b : t.member_a;
      const { rows: [o] } = await db.query('SELECT status FROM memberships WHERE id = $1', [otherId]);
      if (o.status !== 'active') throw forbidden('This person is no longer part of the team.');
    }
    // A request can be discussed only privately, between the person who
    // made it and someone else (usually their manager).
    if (refType === 'shift_request') {
      const { rows: [r] } = await db.query('SELECT membership_id FROM shift_requests WHERE id = $1 AND business_id = $2', [refId, req.member.businessId]);
      if (!r || t.kind !== 'direct' || (r.membership_id !== t.member_a && r.membership_id !== t.member_b)) {
        throw badRequest('invalid_ref', 'That request can\'t be discussed here.');
      }
    }
    const { rows: [m] } = await db.query(
      'INSERT INTO chat_messages (thread_id, business_id, sender_id, body, ref_type, ref_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [t.id, req.member.businessId, req.member.id, text, refType ?? null, refType ? refId : null]);
    await db.query('UPDATE chat_threads SET last_message_at = $2 WHERE id = $1', [t.id, m.created_at]);
    await db.query(
      `INSERT INTO chat_reads (thread_id, membership_id, last_read_id) VALUES ($1, $2, $3)
       ON CONFLICT (thread_id, membership_id) DO UPDATE SET last_read_id = greatest(chat_reads.last_read_id, EXCLUDED.last_read_id)`,
      [t.id, req.member.id, m.id]);
    const { rows: [u] } = await db.query('SELECT name FROM users WHERE id = $1', [req.auth.user.id]);
    return messageOut({ ...m, sender_name: u.name }, req.member.id);
  });
}

export async function removeMessage(app, req, id, messageId) {
  const db = app.db;
  const t = await thread(db, req, id);
  const { rows: [m] } = await db.query('SELECT * FROM chat_messages WHERE id = $1 AND thread_id = $2', [messageId, t.id]);
  if (!m) throw notFound();
  const own = m.sender_id === req.member.id;
  const moderator = t.kind === 'team' && req.member.role === 'owner';
  if (!own && !moderator) throw forbidden();
  await db.query('UPDATE chat_messages SET deleted_at = now(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL', [m.id, req.auth.user.id]);
  // Removing someone else's message is a moderation step worth recording.
  if (!own) await auditB(db, req, { action: 'chat.message_removed', targetType: 'chat_message', targetId: null, after: { threadId: t.id, messageId: Number(m.id) } });
  return { ok: true };
}

// "Discuss" on a holiday or shift request: the person who asked talks to
// their manager (who they report to, else their department's manager, else
// the owner); a manager who can review it talks to the person who asked.
export async function discuss(app, req, requestId) {
  const db = app.db;
  const { rows: [r] } = await db.query(
    `SELECT r.id, r.membership_id, m.reports_to, d.manager_membership_id AS dept_manager
       FROM shift_requests r JOIN memberships m ON m.id = r.membership_id LEFT JOIN departments d ON d.id = m.department_id AND d.archived_at IS NULL
      WHERE r.id = $1 AND r.business_id = $2`, [requestId, req.member.businessId]);
  if (!r) throw notFound();
  let withId;
  if (r.membership_id === req.member.id) {
    const { rows } = await db.query(
      `SELECT id FROM memberships WHERE business_id = $1 AND status = 'active' AND id <> $2
          AND (id = $3 OR id = $4 OR role = 'owner')
        ORDER BY (id = $3) DESC, (id = $4) DESC LIMIT 1`, [req.member.businessId, req.member.id, r.reports_to, r.dept_manager]);
    if (!rows.length) throw badRequest('no_manager', 'There is nobody to discuss this with yet.');
    withId = rows[0].id;
  } else {
    if (!can(req, 'shift_requests.approve') || !(await inScope(req, r.membership_id))) throw notFound();
    withId = r.membership_id;
  }
  const thread = await openDirect(app, req, { membershipId: withId });
  return { threadId: thread.id, requestId: r.id };
}
