import { randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { loadPermissions } from './permissions.js';

export const COOKIE = 'wf_session';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TOUCH_MS = 5 * 60 * 1000;

export async function createSession(db, app, req, reply, userId) {
  const token = randomToken();
  const csrf = randomToken();
  const { idleDays, absoluteDays } = app.config.session;
  const { rows } = await db.query(
    `INSERT INTO sessions (user_id, token_hash, csrf_token, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval) RETURNING id`,
    [userId, sha256(token), csrf, req.headers['user-agent']?.slice(0, 300) ?? null, req.ip, absoluteDays],
  );
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    secure: app.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: idleDays * 86400,
  });
  return { id: rows[0].id, csrf };
}

export function clearSessionCookie(reply) {
  reply.clearCookie(COOKIE, { path: '/' });
}

// Loads the signed-in user (if any) for every request and enforces CSRF on
// state-changing requests made with a session.
export function sessionPlugin(app) {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (!token) return;
    const { idleDays } = app.config.session;
    const { rows } = await app.db.query(
      `SELECT s.id AS session_id, s.csrf_token AS session_csrf, s.last_seen_at AS session_last_seen, u.*
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.last_seen_at > now() - ($2 || ' days')::interval AND u.status = 'active'`,
      [sha256(token), idleDays],
    );
    if (!rows[0]) {
      clearSessionCookie(reply);
      return;
    }
    const { session_id: sessionId, session_csrf: csrf, session_last_seen: lastSeen, ...user } = rows[0];
    req.auth = { sessionId, csrf, user };
    if (UNSAFE.has(req.method)) {
      const sent = req.headers['x-csrf-token'];
      if (!sent || !safeEqual(sent, csrf)) {
        throw new AppError(403, 'csrf', 'Your session has expired. Refresh the page and try again.');
      }
    }
    if (Date.now() - new Date(lastSeen).getTime() > TOUCH_MS) {
      await app.db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [sessionId]);
    }
  });
}

export async function requireUser(req) {
  if (!req.auth) throw unauthorized();
}

// A user is fully verified when every contact method they signed up with is
// confirmed, or the business demands it (spec §17).
export function isVerified(user, business) {
  if (user.email && !user.email_verified_at) return false;
  if (user.phone && !user.phone_verified_at && (!user.email || business?.settings?.auth?.requirePhoneVerification)) return false;
  return true;
}

// preHandler for /api/b/:businessId/* routes. Checks membership and status on
// every request, so suspending someone takes effect immediately.
export async function requireMember(req) {
  await requireUser(req);
  const businessId = req.params.businessId;
  if (!/^[0-9a-f-]{36}$/i.test(businessId || '')) throw notFound();
  const { rows } = await req.server.db.query(
    `SELECT m.*, b.name AS business_name, b.settings AS business_settings, b.currency,
            b.currency_exponent, b.timezone, b.locale AS business_locale
       FROM memberships m JOIN businesses b ON b.id = m.business_id
      WHERE m.business_id = $1 AND m.user_id = $2 AND b.archived_at IS NULL`,
    [businessId, req.auth.user.id],
  );
  const m = rows[0];
  // Same answer for "no such business" and "not a member", so IDs can't be probed.
  if (!m) throw notFound();
  if (m.status !== 'active') throw forbidden('Your access to this business is not active.');
  if (!isVerified(req.auth.user, { settings: m.business_settings })) {
    throw new AppError(403, 'verification_required', 'Please verify your account to continue.');
  }
  req.member = {
    id: m.id,
    role: m.role,
    businessId: m.business_id,
    business: { id: m.business_id, name: m.business_name, settings: m.business_settings, locale: m.business_locale },
    permissions: await loadPermissions(req.server.db, m),
  };
}

export function can(req, permission) {
  return !!req.member?.permissions.has(permission);
}

export function requirePermission(...permissions) {
  return async (req) => {
    if (!req.member) await requireMember(req);
    if (!permissions.every((p) => req.member.permissions.has(p))) throw forbidden();
  };
}
