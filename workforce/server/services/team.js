import { transaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { maskEmail, maskPhone, normalizeEmail, normalizePhone } from '../lib/identity.js';
import { checkPasswordStrength, hashPassword } from '../lib/password.js';
import { rateLimit } from '../lib/rate-limit.js';
import { notify } from '../lib/notify.js';
import { queueMessage } from '../messaging/outbox.js';
import { render } from '../messaging/templates.js';
import { createSession, can } from '../auth/session.js';
import { PERMISSIONS, PERMISSION_KEYS, defaultAllowed, isOwnerOnly } from '../auth/permissions.js';
import { managedScope, scopeSql } from '../lib/context.js';
import { currentPaySql } from './people.js';

const PAY_FIELDS = ['payType', 'payRate', 'payFrequency'];

function flush(app, req) {
  app.outbox.flush().catch((err) => req.log.error({ err }, 'outbox flush failed'));
}

// ---------- invitations ----------

function invitationStatus(inv) {
  if (inv.accepted_at) return 'accepted';
  if (inv.revoked_at) return 'revoked';
  if (new Date(inv.expires_at) < new Date()) return 'expired';
  return 'pending';
}

function publicInvitation(inv) {
  return {
    id: inv.id,
    name: inv.name,
    email: inv.email,
    phone: inv.phone,
    role: inv.role,
    status: invitationStatus(inv),
    expiresAt: inv.expires_at,
    createdAt: inv.created_at,
    lastSentAt: inv.last_sent_at,
  };
}

async function sendInvitation(app, db, req, inv, token) {
  const link = `${app.config.appUrl}/#/invite?token=${token}`;
  const locale = req.member.business.locale;
  const vars = { name: inv.name, business: req.member.business.name, role: inv.role, link, days: app.config.invitationDays };
  if (inv.email) {
    await queueMessage(db, { channel: 'email', to: inv.email, ...render('invitation', locale, vars), sensitive: true });
  } else {
    await queueMessage(db, { channel: 'sms', to: inv.phone, ...render('invitationSms', locale, vars), sensitive: true });
  }
}

export async function createInvitation(app, req, input) {
  const { businessId } = req.member;
  // Only someone who can assign roles (the owner) can bring in a manager.
  if (input.role === 'manager' && !can(req, 'roles.assign')) throw forbidden('Only the owner can invite managers.');
  const profile = { ...(input.profile || {}) };
  if (PAY_FIELDS.some((f) => f in profile) && !can(req, 'payroll.manage')) {
    throw forbidden('You don\'t have permission to set pay information.');
  }
  // A department manager's invitees join their department, so the manager
  // can see and schedule them; anyone else's choice must be a live department.
  const scope = await managedScope(req);
  if (profile.departmentId) {
    const { rowCount } = await app.db.query('SELECT 1 FROM departments WHERE id = $1 AND business_id = $2 AND archived_at IS NULL', [profile.departmentId, businessId]);
    if (!rowCount || (scope && !scope.departmentIds.includes(profile.departmentId))) throw badRequest('invalid_department', 'Choose one of your departments.');
  } else if (scope && !profile.department) {
    profile.departmentId = scope.departmentIds[0];
  }
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (!email && !phone) throw badRequest('contact_required', 'Enter an email address or phone number.');
  await rateLimit(app.db, `invite:${businessId}`, 200, 86400);

  const token = randomToken();
  const inv = await transaction(app.db, async (db) => {
    const member = await db.query(
      `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.business_id = $1 AND (u.email = $2 OR u.phone = $3)`, [businessId, email, phone]);
    if (member.rows[0]) throw conflict('already_member', 'This person is already part of your team.');
    const pending = await db.query(
      `SELECT 1 FROM invitations WHERE business_id = $1 AND (email = $2 OR phone = $3)
         AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, [businessId, email, phone]);
    if (pending.rows[0]) throw conflict('already_invited', 'This person already has a pending invitation. Resend it instead.');
    const { rows: [row] } = await db.query(
      `INSERT INTO invitations (business_id, name, email, phone, role, profile, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + ($9 || ' days')::interval) RETURNING *`,
      [businessId, input.name.trim(), email, phone, input.role, JSON.stringify(profile), sha256(token), req.auth.user.id, app.config.invitationDays]);
    await sendInvitation(app, db, req, row, token);
    await audit(db, req, { businessId, action: 'invitation.created', targetType: 'invitation', targetId: row.id, after: { name: row.name, email, phone, role: row.role } });
    return row;
  });
  flush(app, req);
  return publicInvitation(inv);
}

export async function listInvitations(app, req) {
  const { rows } = await app.db.query(
    'SELECT * FROM invitations WHERE business_id = $1 AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 200',
    [req.member.businessId]);
  return rows.map(publicInvitation);
}

async function loadInvitation(db, req, id) {
  const { rows: [inv] } = await db.query(
    'SELECT * FROM invitations WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
  if (!inv) throw notFound();
  if (inv.role === 'manager' && !can(req, 'roles.assign')) throw forbidden();
  return inv;
}

export async function resendInvitation(app, req, id) {
  await rateLimit(app.db, `invite-resend:${id}`, 5, 86400);
  const token = randomToken();
  await transaction(app.db, async (db) => {
    const inv = await loadInvitation(db, req, id);
    if (inv.accepted_at || inv.revoked_at) throw conflict('invitation_closed', 'This invitation can no longer be sent.');
    // A new token replaces the old link, and the expiry restarts.
    const { rows: [row] } = await db.query(
      `UPDATE invitations SET token_hash = $2, last_sent_at = now(), expires_at = now() + ($3 || ' days')::interval
        WHERE id = $1 RETURNING *`, [id, sha256(token), app.config.invitationDays]);
    await sendInvitation(app, db, req, row, token);
    await audit(db, req, { businessId: req.member.businessId, action: 'invitation.resent', targetType: 'invitation', targetId: id });
  });
  flush(app, req);
}

export async function revokeInvitation(app, req, id) {
  await transaction(app.db, async (db) => {
    const inv = await loadInvitation(db, req, id);
    if (inv.accepted_at) throw conflict('invitation_closed', 'This invitation was already accepted.');
    if (inv.revoked_at) return;
    await db.query('UPDATE invitations SET revoked_at = now() WHERE id = $1', [id]);
    await audit(db, req, { businessId: req.member.businessId, action: 'invitation.revoked', targetType: 'invitation', targetId: id });
  });
}

async function findInvitationByToken(db, token, lock = false) {
  const { rows: [inv] } = await db.query(
    `SELECT i.*, b.name AS business_name FROM invitations i JOIN businesses b ON b.id = i.business_id
      WHERE i.token_hash = $1${lock ? ' FOR UPDATE OF i' : ''}`, [sha256(token)]);
  return inv;
}

export async function previewInvitation(app, req, token) {
  await rateLimit(app.db, `invite-preview:ip:${req.ip}`, 60, 900);
  const inv = await findInvitationByToken(app.db, token);
  if (!inv) throw notFound('This invitation link is not valid.');
  const status = invitationStatus(inv);
  const existing = await app.db.query('SELECT 1 FROM users WHERE email = $1 OR phone = $2', [inv.email, inv.phone]);
  return {
    status,
    businessId: inv.business_id,
    businessName: inv.business_name,
    name: inv.name,
    role: inv.role,
    email: maskEmail(inv.email),
    phone: maskPhone(inv.phone),
    accountExists: !!existing.rows[0],
  };
}

async function joinBusiness(db, req, inv, userId) {
  const { payType, payRate, payFrequency, department, departmentId: chosen, ...profile } = inv.profile || {};
  let departmentId = null;
  if (chosen) {
    // Still there? It may have been archived since the invitation went out.
    const { rows: [d] } = await db.query('SELECT id FROM departments WHERE id = $1 AND business_id = $2 AND archived_at IS NULL', [chosen, inv.business_id]);
    departmentId = d?.id ?? null;
  }
  if (!departmentId && department) {
    const { rows: [d] } = await db.query(
      'SELECT id FROM departments WHERE business_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL', [inv.business_id, department]);
    departmentId = d?.id ?? (await db.query('INSERT INTO departments (business_id, name) VALUES ($1, $2) RETURNING id', [inv.business_id, department])).rows[0].id;
  }
  const { rows: [m] } = await db.query(
    `INSERT INTO memberships (business_id, user_id, role, profile, department_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_id, user_id) DO NOTHING RETURNING id`,
    [inv.business_id, userId, inv.role, JSON.stringify(profile), departmentId]);
  if (!m) throw conflict('already_member', 'You are already part of this business.');
  if (payRate !== undefined) {
    await db.query(
      `INSERT INTO pay_rates (business_id, membership_id, pay_type, rate, effective_from, note, created_by, frequency)
       VALUES ($1, $2, $3, $4, coalesce($5::date, (now() AT TIME ZONE (SELECT timezone FROM businesses WHERE id = $1))::date), 'Set at invitation', $6, $7)`,
      [inv.business_id, m.id, payType || 'salaried', payRate, profile.startDate || null, inv.invited_by, payFrequency || null]);
  }
  await db.query('UPDATE invitations SET accepted_at = now(), accepted_user_id = $2 WHERE id = $1', [inv.id, userId]);
  await audit(db, req, { businessId: inv.business_id, actorId: userId, action: 'invitation.accepted', targetType: 'membership', targetId: m.id, after: { role: inv.role } });
  await notify(db, { businessId: inv.business_id, userId: inv.invited_by, type: 'invitation.accepted', data: { name: inv.name, role: inv.role } });
}

function assertOpen(inv) {
  if (!inv) throw notFound('This invitation link is not valid.');
  const status = invitationStatus(inv);
  if (status !== 'pending') {
    throw conflict(`invitation_${status}`, status === 'expired'
      ? 'This invitation has expired. Ask your manager to send a new one.'
      : 'This invitation can no longer be used.');
  }
}

// New person: sets their name and password, and is signed in.
export async function acceptInvitation(app, req, reply, { token, name, password }) {
  await rateLimit(app.db, `invite-accept:ip:${req.ip}`, 20, 900);
  checkPasswordStrength(password, { name });
  const hash = await hashPassword(password);
  await transaction(app.db, async (db) => {
    const inv = await findInvitationByToken(db, token, true);
    assertOpen(inv);
    checkPasswordStrength(password, { email: inv.email, name });
    const existing = await db.query('SELECT 1 FROM users WHERE email = $1 OR phone = $2', [inv.email, inv.phone]);
    if (existing.rows[0]) throw conflict('account_exists', 'You already have an account. Sign in to accept this invitation.');
    // The link went to the email if there was one, otherwise by SMS, so that
    // channel is proven by opening it.
    const { rows: [user] } = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, locale, password_changed_at, email_verified_at, phone_verified_at)
       VALUES ($1, $2, $3, $4, $5, now(), $6, $7) RETURNING id`,
      [name.trim(), inv.email, inv.phone, hash, null, inv.email ? new Date() : null, inv.email ? null : new Date()]);
    await joinBusiness(db, req, inv, user.id);
    await createSession(db, app, req, reply, user.id);
  });
}

// Someone already signed in (for example, joining a second business).
export async function acceptInvitationAsUser(app, req, { token }) {
  const user = req.auth.user;
  await transaction(app.db, async (db) => {
    const inv = await findInvitationByToken(db, token, true);
    assertOpen(inv);
    const matches = (inv.email && inv.email === user.email && user.email_verified_at)
      || (inv.phone && inv.phone === user.phone && user.phone_verified_at);
    if (!matches) throw forbidden('This invitation was sent to a different email or phone. Sign in with that account.');
    await joinBusiness(db, req, inv, user.id);
  });
}

// ---------- members ----------

function publicMember(row, req) {
  const profile = { ...row.profile };
  if (!can(req, 'members.view_sensitive') && row.user_id !== req.auth.user.id) {
    for (const f of PAY_FIELDS) delete profile[f];
  }
  const payOk = can(req, 'members.view_sensitive') || can(req, 'payroll.view') || row.user_id === req.auth.user.id;
  return {
    membershipId: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    profile,
    departmentId: row.department_id ?? null,
    departmentName: row.department_name ?? null,
    pay: payOk ? row.pay ?? null : undefined,
    joinedAt: row.created_at,
  };
}

export async function listMembers(app, req, { q, role, status, departmentId, limit = 50, cursor }) {
  const params = [req.member.businessId];
  const where = ['m.business_id = $1'];
  // Managers who run departments see their own people (spec §2).
  where.push(scopeSql(await managedScope(req), params));
  if (departmentId) { params.push(departmentId); where.push(`m.department_id = $${params.length}`); }
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`);
    where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.phone ILIKE $${params.length})`);
  }
  if (role) { params.push(role); where.push(`m.role = $${params.length}`); }
  if (status) { params.push(status); where.push(`m.status = $${params.length}`); }
  if (cursor) {
    let c;
    try {
      c = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    } catch {
      throw badRequest('invalid_cursor', 'Invalid page cursor.');
    }
    params.push(c[0], c[1]);
    where.push(`(lower(u.name), m.id) > ($${params.length - 1}, $${params.length}::uuid)`);
  }
  // Total for the filters, before paging (the cursor condition is not included).
  const filterCount = cursor ? where.length - 1 : where.length;
  const filterParams = cursor ? params.slice(0, -2) : [...params];
  const { rows: [{ total }] } = await app.db.query(
    `SELECT count(*) AS total FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE ${where.slice(0, filterCount).join(' AND ')}`, filterParams);
  params.push(Math.min(Math.max(limit, 1), 100) + 1);
  const { rows } = await app.db.query(
    `SELECT m.*, u.name, u.email, u.phone, d.name AS department_name, ${currentPaySql} AS pay
       FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN departments d ON d.id = m.department_id
      WHERE ${where.join(' AND ')} ORDER BY lower(u.name), m.id LIMIT $${params.length}`, params);
  const pageSize = params[params.length - 1] - 1;
  const more = rows.length > pageSize;
  const page = rows.slice(0, pageSize);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => publicMember(r, req)),
    total,
    nextCursor: more ? Buffer.from(JSON.stringify([last.name.toLowerCase(), last.id])).toString('base64url') : null,
  };
}

async function loadTarget(db, req, membershipId) {
  const { rows: [m] } = await db.query(
    `SELECT m.*, u.name, u.email, u.phone, u.locale AS user_locale FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.id = $1 AND m.business_id = $2 FOR UPDATE OF m`, [membershipId, req.member.businessId]);
  if (!m) throw notFound();
  if (m.role === 'owner') throw forbidden('The owner\'s account can\'t be changed here.');
  if (m.user_id === req.auth.user.id) throw forbidden('You can\'t change your own access.');
  // Anyone below owner may only act on employees, never on other managers.
  if (req.member.role !== 'owner' && m.role !== 'employee') throw forbidden();
  return m;
}

export async function changeRole(app, req, membershipId, role) {
  const result = await transaction(app.db, async (db) => {
    const m = await loadTarget(db, req, membershipId);
    if (m.status !== 'active') throw conflict('member_inactive', 'Only active team members can change role.');
    if (m.role === role) return publicMember(m, req);
    await db.query('UPDATE memberships SET role = $2, updated_at = now() WHERE id = $1', [m.id, role]);
    // Per-person permission overrides belonged to the old role.
    await db.query('DELETE FROM membership_permissions WHERE membership_id = $1', [m.id]);
    await audit(db, req, { businessId: m.business_id, action: role === 'manager' ? 'member.promoted_manager' : 'member.manager_removed', targetType: 'membership', targetId: m.id, before: { role: m.role }, after: { role } });
    await notify(db, { businessId: m.business_id, userId: m.user_id, type: 'role.changed', data: { role } });
    if (m.email) {
      const msg = render('roleChanged', m.user_locale || req.member.business.locale, { name: m.name, business: req.member.business.name, role });
      await queueMessage(db, { channel: 'email', to: m.email, ...msg });
    }
    return publicMember({ ...m, role }, req);
  });
  flush(app, req);
  return result;
}

export async function setMemberStatus(app, req, membershipId, status) {
  return transaction(app.db, async (db) => {
    const m = await loadTarget(db, req, membershipId);
    const allowed = { suspended: ['active'], active: ['suspended'] };
    if (m.status === status) return publicMember(m, req);
    if (!allowed[status]?.includes(m.status)) {
      throw conflict('invalid_status', 'This change isn\'t possible for this team member\'s current status.');
    }
    await db.query('UPDATE memberships SET status = $2, updated_at = now() WHERE id = $1', [m.id, status]);
    await audit(db, req, { businessId: m.business_id, action: status === 'suspended' ? 'member.suspended' : 'member.reactivated', targetType: 'membership', targetId: m.id, before: { status: m.status }, after: { status } });
    await notify(db, { businessId: m.business_id, userId: m.user_id, type: `member.${status}`, data: {} });
    return publicMember({ ...m, status }, req);
  });
}

// ---------- permission settings ----------

export async function permissionMatrix(app, req) {
  const { rows } = await app.db.query(
    'SELECT role, permission, allowed FROM role_permissions WHERE business_id = $1', [req.member.businessId]);
  const over = new Map(rows.map((r) => [`${r.role}:${r.permission}`, r.allowed]));
  return PERMISSIONS.map((p) => {
    const entry = { key: p.key, group: p.group, ownerOnly: !!p.ownerOnly, roles: {} };
    for (const role of ['manager', 'employee']) {
      const def = defaultAllowed(role, p.key);
      const o = over.get(`${role}:${p.key}`);
      entry.roles[role] = { default: def, allowed: p.ownerOnly ? false : (o ?? def), overridden: o !== undefined };
    }
    return entry;
  });
}

function validateChanges(changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (!PERMISSION_KEYS.has(key)) throw badRequest('unknown_permission', `Unknown permission: ${key}`);
    if (isOwnerOnly(key)) throw forbidden(`"${key}" belongs only to the owner and can't be granted.`);
    if (value !== null && typeof value !== 'boolean') throw badRequest('invalid_value', 'Use true, false or null.');
  }
}

export async function setRolePermissions(app, req, role, changes) {
  validateChanges(changes);
  const { businessId } = req.member;
  await transaction(app.db, async (db) => {
    const { rows } = await db.query(
      'SELECT permission, allowed FROM role_permissions WHERE business_id = $1 AND role = $2 FOR UPDATE', [businessId, role]);
    const before = Object.fromEntries(rows.map((r) => [r.permission, r.allowed]));
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) {
        await db.query('DELETE FROM role_permissions WHERE business_id = $1 AND role = $2 AND permission = $3', [businessId, role, key]);
      } else {
        await db.query(
          `INSERT INTO role_permissions (business_id, role, permission, allowed) VALUES ($1, $2, $3, $4)
           ON CONFLICT (business_id, role, permission) DO UPDATE SET allowed = $4, updated_at = now()`,
          [businessId, role, key, value]);
      }
    }
    await audit(db, req, { businessId, action: 'permissions.role_updated', targetType: 'role', targetId: role, before, after: changes });
  });
}

export async function memberPermissions(app, req, membershipId) {
  const { rows: [m] } = await app.db.query(
    'SELECT id, role FROM memberships WHERE id = $1 AND business_id = $2', [membershipId, req.member.businessId]);
  if (!m) throw notFound();
  const { rows } = await app.db.query('SELECT permission, allowed FROM membership_permissions WHERE membership_id = $1', [m.id]);
  return { role: m.role, overrides: Object.fromEntries(rows.map((r) => [r.permission, r.allowed])) };
}

export async function setMemberPermissions(app, req, membershipId, changes) {
  validateChanges(changes);
  await transaction(app.db, async (db) => {
    const m = await loadTarget(db, req, membershipId);
    const { rows } = await db.query('SELECT permission, allowed FROM membership_permissions WHERE membership_id = $1', [m.id]);
    const before = Object.fromEntries(rows.map((r) => [r.permission, r.allowed]));
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) {
        await db.query('DELETE FROM membership_permissions WHERE membership_id = $1 AND permission = $2', [m.id, key]);
      } else {
        await db.query(
          `INSERT INTO membership_permissions (membership_id, permission, allowed) VALUES ($1, $2, $3)
           ON CONFLICT (membership_id, permission) DO UPDATE SET allowed = $3, updated_at = now()`, [m.id, key, value]);
      }
    }
    await audit(db, req, { businessId: m.business_id, action: 'permissions.member_updated', targetType: 'membership', targetId: m.id, before, after: changes });
  });
}

// ---------- audit log ----------

export async function listAuditLogs(app, req, { action, actorId, targetType, targetId, from, to, before, limit = 50 }) {
  const params = [req.member.businessId];
  const where = ['a.business_id = $1'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (action) add('a.action LIKE ?', `${action.replace(/[%_\\]/g, (c) => '\\' + c)}%`);
  if (actorId) add('a.actor_user_id = ?::uuid', actorId);
  if (targetType) add('a.target_type = ?', targetType);
  if (targetId) add('a.target_id = ?', targetId);
  if (from) add('a.created_at >= ?::timestamptz', from);
  if (to) add('a.created_at < ?::timestamptz', to);
  if (before) add('a.id < ?', before);
  params.push(Math.min(Math.max(limit, 1), 200));
  const { rows } = await app.db.query(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.before, a.after, host(a.ip) AS ip,
            a.user_agent, a.created_at, a.actor_user_id, u.name AS actor_name,
            CASE a.target_type
              WHEN 'membership' THEN (SELECT tu.name FROM memberships tm JOIN users tu ON tu.id = tm.user_id
                                       WHERE tm.id::text = a.target_id AND tm.business_id = a.business_id)
              WHEN 'invitation' THEN (SELECT ti.name FROM invitations ti
                                       WHERE ti.id::text = a.target_id AND ti.business_id = a.business_id)
              WHEN 'user' THEN (SELECT tu.name FROM users tu WHERE tu.id::text = a.target_id)
              WHEN 'business' THEN (SELECT tb.name FROM businesses tb WHERE tb.id::text = a.target_id)
              ELSE NULL
            END AS target_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT $${params.length}`, params);
  return {
    items: rows.map((r) => ({
      id: r.id, action: r.action, targetType: r.target_type, targetId: r.target_id, targetName: r.target_name, before: r.before, after: r.after,
      ip: r.ip, userAgent: r.user_agent, createdAt: r.created_at, actor: r.actor_user_id ? { id: r.actor_user_id, name: r.actor_name } : null,
    })),
    nextBefore: rows.length === params[params.length - 1] ? rows[rows.length - 1].id : null,
  };
}
