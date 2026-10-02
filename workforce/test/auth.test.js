import assert from 'node:assert/strict';
import { PASSWORD, client, codeIn, ownerWithBusiness, setup, tokenIn } from './helpers.js';
import { totpCode } from '../server/lib/totp.js';

describe('authentication', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('registers a business, requires email verification, then grants owner access', async () => {
    const c = client(t.app);
    const reg = await c.post('/api/auth/register', { businessName: 'Shop', name: 'Ali', email: 'Ali@Example.com', password: PASSWORD });
    assert.equal(reg.status, 201);
    let me = await c.refresh();
    assert.equal(me.user.email, 'ali@example.com');
    assert.equal(me.user.emailVerified, false);
    const bid = me.businesses[0].id;
    assert.equal(me.businesses[0].role, 'owner');

    // Business routes stay closed until the email is verified.
    const blocked = await c.get(`/api/b/${bid}/members`);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'verification_required');

    const wrong = await c.post('/api/auth/verify/email', { code: '000000' });
    assert.equal(wrong.status, 400);
    const msg = await t.lastMessage('ali@example.com');
    assert.equal((await c.post('/api/auth/verify/email', { code: codeIn(msg) })).status, 200);
    me = await c.refresh();
    assert.equal(me.user.emailVerified, true);
    assert.equal((await c.get(`/api/b/${bid}/members`)).status, 200);
  });

  it('puts a per-address ceiling in front of every route, tighter on sign-in', async () => {
    const health = await t.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.headers['x-ratelimit-limit'], '600');
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: 'x@example.com', password: 'whatever password' } });
    assert.equal(login.headers['x-ratelimit-limit'], '60');
    // Past the ceiling the answer is the app's usual error shape.
    let res;
    // (The health check has no database limit, so this is the new ceiling.)
    for (let i = 0; i < 601; i++) res = await t.app.inject({ method: 'GET', url: '/api/health', remoteAddress: '10.9.9.9' });
    assert.equal(res.statusCode, 429);
    assert.equal(JSON.parse(res.body).error.code, 'rate_limited');
    // Other addresses are unaffected.
    assert.equal((await t.app.inject({ method: 'GET', url: '/api/health', remoteAddress: '10.9.9.10' })).statusCode, 200);
  });

  it('stores passwords with argon2id, never in plain text', async () => {
    await ownerWithBusiness(t);
    const { rows: [u] } = await t.pool.query('SELECT password_hash FROM users');
    assert.match(u.password_hash, /^\$argon2id\$/);
    assert.ok(!u.password_hash.includes(PASSWORD));
  });

  it('rejects weak passwords and duplicate accounts', async () => {
    const c = client(t.app);
    const weak = await c.post('/api/auth/register', { businessName: 'S', name: 'A', email: 'a@example.com', password: 'short' });
    assert.equal(weak.body.error.code, 'weak_password');
    await ownerWithBusiness(t, { email: 'dup@example.com' });
    const dup = await client(t.app).post('/api/auth/register', { businessName: 'S2', name: 'B', email: 'dup@example.com', password: PASSWORD });
    assert.equal(dup.status, 409);
  });

  it('gives the same error for unknown accounts and wrong passwords', async () => {
    await ownerWithBusiness(t);
    const a = await client(t.app).post('/api/auth/login', { identifier: 'nobody@example.com', password: PASSWORD });
    const b = await client(t.app).post('/api/auth/login', { identifier: 'owner@example.com', password: 'wrong password!!' });
    assert.equal(a.status, 401);
    assert.deepEqual(a.body.error.message, b.body.error.message);
    assert.equal(a.body.error.code, b.body.error.code);
  });

  it('signs in with email and password, and logs out', async () => {
    await ownerWithBusiness(t);
    const c = client(t.app);
    const res = await c.post('/api/auth/login', { identifier: ' OWNER@example.com ', password: PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.body.twoFactorRequired, false);
    assert.ok((await c.refresh()).user);
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  it('rate-limits repeated sign-in attempts', async () => {
    await ownerWithBusiness(t);
    const c = client(t.app, '10.0.0.9');
    let last;
    for (let i = 0; i < 11; i++) last = await c.post('/api/auth/login', { identifier: 'owner@example.com', password: 'wrong password!!' });
    assert.equal(last.status, 429);
    // Even the right password is refused while limited.
    const ok = await c.post('/api/auth/login', { identifier: 'owner@example.com', password: PASSWORD });
    assert.equal(ok.status, 429);
  });

  it('requires the CSRF token on state-changing requests', async () => {
    const { owner } = await ownerWithBusiness(t);
    owner.setCsrf('forged');
    const res = await owner.post('/api/auth/logout-all');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'csrf');
  });

  it('lists sessions, signs out one device, and signs out everywhere', async () => {
    await ownerWithBusiness(t);
    const phone = client(t.app);
    const laptop = client(t.app);
    await phone.post('/api/auth/login', { identifier: 'owner@example.com', password: PASSWORD });
    await laptop.post('/api/auth/login', { identifier: 'owner@example.com', password: PASSWORD });
    await phone.refresh();
    await laptop.refresh();
    const list = await laptop.get('/api/auth/sessions');
    assert.ok(list.body.length >= 2);
    const phoneSession = list.body.find((s) => !s.current);
    assert.equal((await laptop.del(`/api/auth/sessions/${phoneSession.id}`)).status, 200);

    await laptop.post('/api/auth/logout-all', { keepCurrent: true });
    assert.equal((await laptop.get('/api/auth/me')).status, 200);
    assert.equal((await phone.get('/api/auth/me')).status, 401);
    await laptop.post('/api/auth/logout-all');
    assert.equal((await laptop.get('/api/auth/me')).status, 401);
  });

  it('resets a password by email link, which signs out every session', async () => {
    const { owner } = await ownerWithBusiness(t);
    const anon = client(t.app);
    // Unknown accounts get the same reply.
    assert.equal((await anon.post('/api/auth/password/forgot', { identifier: 'ghost@example.com' })).status, 200);
    assert.equal((await anon.post('/api/auth/password/forgot', { identifier: 'owner@example.com' })).status, 200);
    const token = tokenIn(await t.lastMessage('owner@example.com'));
    assert.equal((await anon.post('/api/auth/password/reset', { token, password: 'a brand new passphrase' })).status, 200);
    // The link works once.
    assert.equal((await anon.post('/api/auth/password/reset', { token, password: 'another new passphrase' })).status, 400);
    assert.equal((await owner.get('/api/auth/me')).status, 401);
    const login = await client(t.app).post('/api/auth/login', { identifier: 'owner@example.com', password: 'a brand new passphrase' });
    assert.equal(login.status, 200);
    // The delivered message body is redacted in storage.
    const { rows } = await t.pool.query('SELECT body FROM outbound_messages WHERE sensitive');
    assert.ok(rows.every((r) => r.body === '[redacted]'));
  });

  it('registers with a phone, verifies by SMS and resets by SMS code', async () => {
    const c = client(t.app);
    const reg = await c.post('/api/auth/register', { businessName: 'Cafe', name: 'Zainab', phone: '0770 123 4567', password: PASSWORD });
    assert.equal(reg.status, 201);
    const me = await c.refresh();
    assert.equal(me.user.phone, '+9647701234567');
    const otp = codeIn(await t.lastMessage('+9647701234567'));
    // Five wrong attempts burn the code.
    for (let i = 0; i < 5; i++) await c.post('/api/auth/verify/phone', { code: otp === '111111' ? '222222' : '111111' });
    assert.equal((await c.post('/api/auth/verify/phone', { code: otp })).status, 400);

    // Resend is throttled to once a minute.
    await t.pool.query('DELETE FROM rate_limits');
    assert.equal((await c.post('/api/auth/verify/phone/request')).status, 200);
    assert.equal((await c.post('/api/auth/verify/phone/request')).status, 429);
    const fresh = codeIn(await t.lastMessage('+9647701234567'));
    assert.equal((await c.post('/api/auth/verify/phone', { code: fresh })).status, 200);

    await client(t.app).post('/api/auth/password/forgot', { identifier: '+9647701234567' });
    const code = codeIn(await t.lastMessage('+9647701234567'));
    const reset = await client(t.app).post('/api/auth/password/reset', { identifier: '07701234567', code, password: 'phone reset passphrase' });
    assert.equal(reset.status, 200);
  });

  it('expires verification codes', async () => {
    const c = client(t.app);
    await c.post('/api/auth/register', { businessName: 'S', name: 'A', email: 'exp@example.com', password: PASSWORD });
    await c.refresh();
    const code = codeIn(await t.lastMessage('exp@example.com'));
    await t.pool.query('UPDATE verification_tokens SET expires_at = now() - interval \'1 second\'');
    assert.equal((await c.post('/api/auth/verify/email', { code })).status, 400);
  });

  it('supports authenticator-app two-step verification with recovery codes', async () => {
    const { owner } = await ownerWithBusiness(t);
    const setupRes = await owner.post('/api/auth/2fa/setup');
    const { secret } = setupRes.body;
    assert.equal((await owner.post('/api/auth/2fa/enable', { code: '123456' })).status, 400);
    const enabled = await owner.post('/api/auth/2fa/enable', { code: totpCode(secret) });
    assert.equal(enabled.body.recoveryCodes.length, 10);
    const { rows: [u] } = await t.pool.query('SELECT totp_secret_enc FROM users');
    assert.ok(!u.totp_secret_enc.includes(secret), 'secret is encrypted at rest');

    const c = client(t.app);
    const first = await c.post('/api/auth/login', { identifier: 'owner@example.com', password: PASSWORD });
    assert.equal(first.body.twoFactorRequired, true);
    assert.equal((await c.get('/api/auth/me')).status, 401, 'no session before the second step');
    assert.equal((await c.post('/api/auth/login/2fa', { challenge: first.body.challenge, code: totpCode(secret) })).status, 200);
    assert.equal((await c.get('/api/auth/me')).status, 200);

    const d = client(t.app);
    const again = await d.post('/api/auth/login', { identifier: 'owner@example.com', password: PASSWORD });
    const recovery = enabled.body.recoveryCodes[0];
    assert.equal((await d.post('/api/auth/login/2fa', { challenge: again.body.challenge, code: recovery })).status, 200);
    const me = await d.refresh();
    assert.equal(me.user.recoveryCodesLeft, 9);
    // A recovery code works once.
    const e = client(t.app);
    const third = await e.post('/api/auth/login', { identifier: 'owner@example.com', password: PASSWORD });
    assert.equal((await e.post('/api/auth/login/2fa', { challenge: third.body.challenge, code: recovery })).status, 400);
  });

  it('changes the password and signs out other devices', async () => {
    const { owner } = await ownerWithBusiness(t);
    const other = client(t.app);
    await other.post('/api/auth/login', { identifier: 'owner@example.com', password: PASSWORD });
    const bad = await owner.post('/api/auth/password/change', { currentPassword: 'nope nope nope', newPassword: 'fresh passphrase 1' });
    assert.equal(bad.status, 400);
    assert.equal((await owner.post('/api/auth/password/change', { currentPassword: PASSWORD, newPassword: 'fresh passphrase 1' })).status, 200);
    assert.equal((await owner.get('/api/auth/me')).status, 200);
    assert.equal((await other.get('/api/auth/me')).status, 401);
  });

  it('hides internal errors behind a friendly message with a request id', async () => {
    const res = await client(t.app).post('/api/auth/login', { identifier: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_input');
    assert.ok(res.body.error.requestId);
  });
});

describe('codes typed on an Arabic keyboard', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('accepts Arabic-Indic digits in verification codes', async () => {
    const c = client(t.app);
    await c.post('/api/auth/register', { businessName: 'S', name: 'A', email: 'ar@example.com', password: PASSWORD });
    await c.refresh();
    const code = codeIn(await t.lastMessage('ar@example.com'));
    const arabic = code.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
    assert.equal((await c.post('/api/auth/verify/email', { code: arabic })).status, 200);
  });
});
