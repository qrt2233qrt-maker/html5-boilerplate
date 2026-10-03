import { transaction } from '../db/pool.js';
import { AppError, badRequest, conflict, forbidden } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { decrypt, encrypt, numericCode, randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { normalizeCode, normalizeEmail, normalizePhone, normalizeRecoveryCode, parseIdentifier } from '../lib/identity.js';
import { burnPasswordTime, checkPasswordStrength, hashPassword, verifyPassword } from '../lib/password.js';
import { rateLimit } from '../lib/rate-limit.js';
import { base32Encode, newTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.js';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { queueMessage } from '../messaging/outbox.js';
import { render } from '../messaging/templates.js';
import { loadPermissions } from '../auth/permissions.js';
import { createSession, isVerified } from '../auth/session.js';
import { seedBusiness, seedRestaurant } from './settings.js';

const CODE_MINUTES = 10;
const RESET_LINK_MINUTES = 30;
const invalidCredentials = () => new AppError(401, 'invalid_credentials', 'The email, phone or password is incorrect.');
const invalidCode = () => badRequest('invalid_code', 'That code is incorrect or has expired. Request a new one and try again.');

const localeFor = (user, fallback = 'ar') => user.locale || fallback;

// ---------- one-time codes ----------

async function issueToken(db, userId, purpose, secret, { target = null, minutes = CODE_MINUTES } = {}) {
  await db.query(
    `UPDATE verification_tokens SET consumed_at = now()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`, [userId, purpose]);
  await db.query(
    `INSERT INTO verification_tokens (user_id, purpose, target, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
    [userId, purpose, target, sha256(secret), minutes]);
}

// Checks a code against the latest live token. Runs outside any transaction
// so a wrong guess still counts against the attempt limit.
async function consumeCode(db, userId, purpose, code, target) {
  const { rows } = await db.query(
    `SELECT id, code_hash, attempts, max_attempts FROM verification_tokens
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
        AND ($3::text IS NULL OR target = $3)
      ORDER BY created_at DESC LIMIT 1`, [userId, purpose, target ?? null]);
  const tok = rows[0];
  if (!tok || tok.attempts >= tok.max_attempts) throw invalidCode();
  if (!safeEqual(tok.code_hash, sha256(normalizeCode(code)))) {
    await db.query('UPDATE verification_tokens SET attempts = attempts + 1 WHERE id = $1', [tok.id]);
    throw invalidCode();
  }
  const done = await db.query(
    'UPDATE verification_tokens SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [tok.id]);
  if (!done.rows[0]) throw invalidCode();
}

async function sendEmailCode(app, db, user) {
  const code = numericCode();
  await issueToken(db, user.id, 'email_verify', code, { target: user.email });
  const link = `${app.config.appUrl}/#/verify?channel=email&code=${code}`;
  const msg = render('emailVerify', localeFor(user), { name: user.name, code, link });
  await queueMessage(db, { channel: 'email', to: user.email, ...msg, sensitive: true });
}

async function sendPhoneCode(app, db, user) {
  const code = numericCode();
  await issueToken(db, user.id, 'phone_verify', code, { target: user.phone });
  const msg = render('phoneVerify', localeFor(user), { code });
  await queueMessage(db, { channel: 'sms', to: user.phone, ...msg, sensitive: true });
}

// ---------- registration ----------

export async function registerBusiness(app, req, reply, input) {
  if (!app.config.allowBusinessSignup) throw forbidden('New business sign-up is turned off on this server.');
  await rateLimit(app.db, `register:ip:${req.ip}`, 5, 3600);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (!email && !phone) throw badRequest('contact_required', 'Enter an email address or phone number.');
  checkPasswordStrength(input.password, { email, name: input.name });
  const passwordHash = await hashPassword(input.password);
  const locale = input.locale === 'en' ? 'en' : 'ar';

  const result = await transaction(app.db, async (db) => {
    const exists = await db.query('SELECT 1 FROM users WHERE email = $1 OR phone = $2', [email, phone]);
    if (exists.rows[0]) throw conflict('account_exists', 'An account with this email or phone already exists. Sign in instead.');
    const { rows: [user] } = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, locale, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING *`,
      [input.name.trim(), email, phone, passwordHash, locale]);
    const { rows: [business] } = await db.query(
      `INSERT INTO businesses (name, currency, currency_exponent, timezone, locale)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.businessName.trim(), input.currency || 'IQD', input.currencyExponent ?? 0, input.timezone || 'Asia/Baghdad', locale]);
    await db.query(
      'INSERT INTO memberships (business_id, user_id, role) VALUES ($1, $2, \'owner\')', [business.id, user.id]);
    await seedBusiness(db, business.id);
    if (input.businessKind === 'restaurant') await seedRestaurant(db, business.id, locale);
    await audit(db, req, { businessId: business.id, actorId: user.id, action: 'business.created', targetType: 'business', targetId: business.id, after: { name: business.name } });
    if (email) await sendEmailCode(app, db, user);
    else await sendPhoneCode(app, db, user);
    const session = await createSession(db, app, req, reply, user.id);
    return { user, session };
  });
  app.outbox.flush().catch((err) => req.log.error({ err }, 'outbox flush failed'));
  return result;
}

// ---------- sign in ----------

export async function login(app, req, reply, { identifier, password }) {
  let id;
  try {
    id = parseIdentifier(identifier);
  } catch {
    throw invalidCredentials();
  }
  const idKey = id.email || id.phone;
  await rateLimit(app.db, `login:ip:${req.ip}`, 30, 900);
  await rateLimit(app.db, `login:id:${idKey}`, 10, 900);

  const { rows: [user] } = await app.db.query(
    'SELECT * FROM users WHERE ' + (id.email ? 'email = $1' : 'phone = $1'), [idKey]);
  if (!user) {
    await burnPasswordTime(password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.password_hash, password))) throw invalidCredentials();
  // Only reveal account state after the correct password.
  if (user.status !== 'active') throw forbidden('This account has been disabled. Contact your business owner.');
  const { rows: [m] } = await app.db.query(
    'SELECT count(*) AS total, count(*) FILTER (WHERE status = \'active\') AS active FROM memberships WHERE user_id = $1', [user.id]);
  if (m.total > 0 && m.active === 0) {
    throw new AppError(403, 'access_suspended', 'Your access has been suspended or ended. Contact your business owner.');
  }

  if (user.totp_enabled_at) {
    const challenge = randomToken();
    await issueToken(app.db, user.id, 'login_2fa', challenge, { minutes: 5 });
    return { twoFactorRequired: true, challenge };
  }
  await transaction(app.db, async (db) => {
    await createSession(db, app, req, reply, user.id);
    await audit(db, req, { actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id });
  });
  return { twoFactorRequired: false };
}

export async function loginTwoFactor(app, req, reply, { challenge, code }) {
  await rateLimit(app.db, `2fa:ip:${req.ip}`, 30, 900);
  const { rows: [tok] } = await app.db.query(
    `SELECT id, user_id, attempts, max_attempts FROM verification_tokens
      WHERE code_hash = $1 AND purpose = 'login_2fa' AND consumed_at IS NULL AND expires_at > now()`,
    [sha256(challenge)]);
  if (!tok || tok.attempts >= tok.max_attempts) throw badRequest('challenge_expired', 'Your sign-in has expired. Please sign in again.');
  const tokenId = tok.id;
  const { rows: [user] } = await app.db.query('SELECT * FROM users WHERE id = $1', [tok.user_id]);

  const secret = decrypt(user.totp_secret_enc, app.config.encryptionKey);
  let usedRecovery = null;
  let ok = verifyTotp(secret, normalizeCode(code));
  if (!ok) {
    const h = sha256(normalizeRecoveryCode(code));
    if (user.recovery_codes.includes(h)) {
      ok = true;
      usedRecovery = h;
    }
  }
  if (!ok) {
    await app.db.query('UPDATE verification_tokens SET attempts = attempts + 1 WHERE id = $1', [tokenId]);
    throw invalidCode();
  }
  await transaction(app.db, async (db) => {
    const done = await db.query('UPDATE verification_tokens SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [tokenId]);
    if (!done.rows[0]) throw invalidCode();
    if (usedRecovery) {
      await db.query(
        'UPDATE users SET recovery_codes = recovery_codes - $2::text, updated_at = now() WHERE id = $1',
        [user.id, usedRecovery]);
    }
    await createSession(db, app, req, reply, user.id);
    await audit(db, req, { actorId: user.id, action: usedRecovery ? 'auth.login_recovery_code' : 'auth.login', targetType: 'user', targetId: user.id });
  });
}

export async function logout(app, req) {
  await app.db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.auth.sessionId]);
}

export async function logoutAll(app, req, { keepCurrent = false } = {}) {
  await transaction(app.db, async (db) => {
    await db.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
      [req.auth.user.id, keepCurrent ? req.auth.sessionId : null]);
    await audit(db, req, { action: keepCurrent ? 'auth.logout_other_devices' : 'auth.logout_all', targetType: 'user', targetId: req.auth.user.id });
  });
}

export async function listSessions(app, req) {
  const { rows } = await app.db.query(
    `SELECT id, user_agent, host(ip) AS ip, created_at, last_seen_at FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        AND last_seen_at > now() - ($2 || ' days')::interval
      ORDER BY last_seen_at DESC`,
    [req.auth.user.id, app.config.session.idleDays]);
  return rows.map((s) => ({
    id: s.id, userAgent: s.user_agent, ip: s.ip, createdAt: s.created_at, lastSeenAt: s.last_seen_at,
    current: s.id === req.auth.sessionId,
  }));
}

export async function revokeSession(app, req, sessionId) {
  await app.db.query(
    'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [sessionId, req.auth.user.id]);
}

// ---------- verification ----------

export async function requestVerification(app, req, channel) {
  const user = req.auth.user;
  const field = channel === 'email' ? 'email' : 'phone';
  if (!user[field]) throw badRequest('no_contact', `There is no ${field} on this account.`);
  if (user[`${field}_verified_at`]) return;
  await rateLimit(app.db, `verify:${channel}:min:${user.id}`, 1, 60);
  await rateLimit(app.db, `verify:${channel}:hour:${user.id}`, 5, 3600);
  await (channel === 'email' ? sendEmailCode : sendPhoneCode)(app, app.db, user);
  app.outbox.flush().catch((err) => req.log.error({ err }, 'outbox flush failed'));
}

export async function confirmVerification(app, req, channel, code) {
  const user = req.auth.user;
  const field = channel === 'email' ? 'email' : 'phone';
  if (!user[field]) throw badRequest('no_contact', `There is no ${field} on this account.`);
  await consumeCode(app.db, user.id, `${channel}_verify`, code, user[field]);
  await transaction(app.db, async (db) => {
    await db.query(`UPDATE users SET ${field}_verified_at = now(), updated_at = now() WHERE id = $1`, [user.id]);
    await audit(db, req, { action: `auth.${channel}_verified`, targetType: 'user', targetId: user.id });
  });
}

// ---------- passwords ----------

// Always succeeds from the caller's point of view, so it can't be used to
// find out which emails or phones have accounts.
export async function forgotPassword(app, req, { identifier }) {
  let id;
  try {
    id = parseIdentifier(identifier);
  } catch {
    return;
  }
  const key = id.email || id.phone;
  await rateLimit(app.db, `forgot:ip:${req.ip}`, 10, 3600);
  await rateLimit(app.db, `forgot:id:${key}`, 3, 3600);
  const { rows: [user] } = await app.db.query(
    `SELECT * FROM users WHERE ${id.email ? 'email' : 'phone'} = $1 AND status = 'active'`, [key]);
  if (!user) return;
  await transaction(app.db, async (db) => {
    if (id.email) {
      const token = randomToken();
      await issueToken(db, user.id, 'password_reset', token, { target: 'email', minutes: RESET_LINK_MINUTES });
      const link = `${app.config.appUrl}/#/reset?token=${token}`;
      await queueMessage(db, { channel: 'email', to: user.email, ...render('resetEmail', localeFor(user), { name: user.name, link }), sensitive: true });
    } else {
      const code = numericCode();
      await issueToken(db, user.id, 'password_reset', code, { target: 'sms' });
      await queueMessage(db, { channel: 'sms', to: user.phone, ...render('resetSms', localeFor(user), { code }), sensitive: true });
    }
    await audit(db, req, { actorId: user.id, action: 'auth.password_reset_requested', targetType: 'user', targetId: user.id });
  });
  app.outbox.flush().catch((err) => req.log.error({ err }, 'outbox flush failed'));
}

export async function resetPassword(app, req, { token, identifier, code, password }) {
  await rateLimit(app.db, `reset:ip:${req.ip}`, 20, 3600);
  // Check the basics before using up the one-time link or code.
  checkPasswordStrength(password);
  let user;
  let channel;
  if (token) {
    const { rows: [tok] } = await app.db.query(
      `SELECT t.id AS token_id, u.* FROM verification_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.code_hash = $1 AND t.purpose = 'password_reset' AND t.target = 'email'
          AND t.consumed_at IS NULL AND t.expires_at > now()`, [sha256(token)]);
    if (!tok) throw badRequest('invalid_link', 'This reset link is invalid or has expired. Request a new one.');
    const done = await app.db.query('UPDATE verification_tokens SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [tok.token_id]);
    if (!done.rows[0]) throw badRequest('invalid_link', 'This reset link is invalid or has expired. Request a new one.');
    user = tok;
    channel = 'email';
  } else {
    let id;
    try {
      id = parseIdentifier(identifier);
    } catch {
      throw invalidCode();
    }
    if (!id.phone) throw invalidCode();
    const { rows: [u] } = await app.db.query('SELECT * FROM users WHERE phone = $1', [id.phone]);
    if (!u) throw invalidCode();
    await consumeCode(app.db, u.id, 'password_reset', code, 'sms');
    user = u;
    channel = 'phone';
  }
  checkPasswordStrength(password, { email: user.email, name: user.name });
  const hash = await hashPassword(password);
  await transaction(app.db, async (db) => {
    // Receiving the link or code proves the user controls that channel.
    await db.query(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now(),
         ${channel}_verified_at = coalesce(${channel}_verified_at, now()) WHERE id = $1`, [user.id, hash]);
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
    await audit(db, req, { actorId: user.id, action: 'auth.password_reset', targetType: 'user', targetId: user.id });
  });
}

export async function changePassword(app, req, { currentPassword, newPassword }) {
  const user = req.auth.user;
  await rateLimit(app.db, `pwchange:${user.id}`, 10, 3600);
  if (!(await verifyPassword(user.password_hash, currentPassword))) {
    throw badRequest('wrong_password', 'Your current password is incorrect.');
  }
  checkPasswordStrength(newPassword, { email: user.email, name: user.name });
  const hash = await hashPassword(newPassword);
  await transaction(app.db, async (db) => {
    await db.query('UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1', [user.id, hash]);
    // Other devices are signed out; this one stays signed in.
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [user.id, req.auth.sessionId]);
    await audit(db, req, { action: 'auth.password_changed', targetType: 'user', targetId: user.id });
  });
}

// ---------- two-factor ----------

export async function setupTwoFactor(app, req) {
  const user = req.auth.user;
  if (user.totp_enabled_at) throw conflict('2fa_enabled', 'Two-step verification is already on.');
  const secret = newTotpSecret();
  await app.db.query('UPDATE users SET totp_secret_enc = $2, updated_at = now() WHERE id = $1',
    [user.id, encrypt(secret, app.config.encryptionKey)]);
  const url = otpauthUrl(secret, user.email || user.phone, 'Workforce');
  // A PNG data URL, so the page shows it with a plain <img> (no injected markup).
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  return { secret, otpauthUrl: url, qr };
}

export async function enableTwoFactor(app, req, { code }) {
  const { rows: [user] } = await app.db.query('SELECT * FROM users WHERE id = $1', [req.auth.user.id]);
  if (user.totp_enabled_at) throw conflict('2fa_enabled', 'Two-step verification is already on.');
  if (!user.totp_secret_enc) throw badRequest('2fa_not_setup', 'Start two-step verification setup first.');
  await rateLimit(app.db, `2fa-enable:${user.id}`, 10, 900);
  if (!verifyTotp(decrypt(user.totp_secret_enc, app.config.encryptionKey), normalizeCode(code))) throw invalidCode();
  const codes = Array.from({ length: 10 }, () => {
    const c = base32Encode(randomBytes(5));
    return `${c.slice(0, 4)}-${c.slice(4, 8)}`;
  });
  await transaction(app.db, async (db) => {
    await db.query('UPDATE users SET totp_enabled_at = now(), recovery_codes = $2, updated_at = now() WHERE id = $1',
      [user.id, JSON.stringify(codes.map((c) => sha256(c)))]);
    await audit(db, req, { action: 'auth.2fa_enabled', targetType: 'user', targetId: user.id });
  });
  return { recoveryCodes: codes };
}

export async function disableTwoFactor(app, req, { password }) {
  const user = req.auth.user;
  if (!(await verifyPassword(user.password_hash, password))) throw badRequest('wrong_password', 'Your password is incorrect.');
  await transaction(app.db, async (db) => {
    await db.query(
      'UPDATE users SET totp_enabled_at = NULL, totp_secret_enc = NULL, recovery_codes = \'[]\', updated_at = now() WHERE id = $1', [user.id]);
    await audit(db, req, { action: 'auth.2fa_disabled', targetType: 'user', targetId: user.id });
  });
}

// ---------- current user ----------

export async function me(app, req) {
  const user = req.auth.user;
  const { rows } = await app.db.query(
    `SELECT m.*, b.name AS business_name, b.currency, b.currency_exponent, b.timezone,
            b.locale AS business_locale, b.settings AS business_settings
       FROM memberships m JOIN businesses b ON b.id = m.business_id
      WHERE m.user_id = $1 AND b.archived_at IS NULL ORDER BY m.created_at`, [user.id]);
  const businesses = [];
  for (const m of rows) {
    businesses.push({
      id: m.business_id,
      name: m.business_name,
      membershipId: m.id,
      role: m.role,
      status: m.status,
      currency: m.currency,
      currencyExponent: m.currency_exponent,
      timezone: m.timezone,
      locale: m.business_locale,
      verified: isVerified(user, { settings: m.business_settings }),
      permissions: m.status === 'active' ? [...(await loadPermissions(app.db, m))] : [],
    });
  }
  return {
    csrfToken: req.auth.csrf,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      emailVerified: !!user.email_verified_at,
      phoneVerified: !!user.phone_verified_at,
      twoFactorEnabled: !!user.totp_enabled_at,
      recoveryCodesLeft: user.recovery_codes.length,
      locale: user.locale,
    },
    businesses,
  };
}
