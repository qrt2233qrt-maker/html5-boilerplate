import * as auth from '../services/auth.js';
import * as team from '../services/team.js';
import { clearSessionCookie, requireUser } from '../auth/session.js';

const str = (max, min = 1) => ({ type: 'string', minLength: min, maxLength: max });
const body = (properties, required = []) => ({ body: { type: 'object', additionalProperties: false, properties, required } });
const password = str(200);
const code = str(20);

// Per client address, in front of the per-account limits in the services.
const SIGN_IN_LIMIT = { max: 60, timeWindow: '1 minute' };

export default async function authRoutes(app) {
  const ok = { ok: true };

  app.post('/api/auth/register', { config: { rateLimit: SIGN_IN_LIMIT },
    schema: body({
      businessName: str(120), name: str(120), email: str(254, 0), phone: str(32, 0), password,
      locale: { enum: ['ar', 'en'] }, currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      currencyExponent: { type: 'integer', minimum: 0, maximum: 4 }, timezone: str(64),
    }, ['businessName', 'name', 'password']),
  }, async (req, reply) => {
    await auth.registerBusiness(app, req, reply, req.body);
    return reply.code(201).send(ok);
  });

  app.post('/api/auth/login', { config: { rateLimit: SIGN_IN_LIMIT }, schema: body({ identifier: str(254), password }, ['identifier', 'password']) },
    async (req, reply) => auth.login(app, req, reply, req.body));

  app.post('/api/auth/login/2fa', { config: { rateLimit: SIGN_IN_LIMIT }, schema: body({ challenge: str(100), code }, ['challenge', 'code']) },
    async (req, reply) => {
      await auth.loginTwoFactor(app, req, reply, req.body);
      return ok;
    });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) await auth.logout(app, req);
    clearSessionCookie(reply);
    return ok;
  });

  app.post('/api/auth/logout-all', {
    preHandler: requireUser,
    schema: body({ keepCurrent: { type: 'boolean' } }),
  }, async (req, reply) => {
    const keepCurrent = !!req.body?.keepCurrent;
    await auth.logoutAll(app, req, { keepCurrent });
    if (!keepCurrent) clearSessionCookie(reply);
    return ok;
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (req) => auth.me(app, req));

  for (const channel of ['email', 'phone']) {
    app.post(`/api/auth/verify/${channel}/request`, { preHandler: requireUser }, async (req) => {
      await auth.requestVerification(app, req, channel);
      return ok;
    });
    app.post(`/api/auth/verify/${channel}`, { preHandler: requireUser, schema: body({ code }, ['code']) }, async (req) => {
      await auth.confirmVerification(app, req, channel, req.body.code);
      return ok;
    });
  }

  app.post('/api/auth/password/forgot', { config: { rateLimit: SIGN_IN_LIMIT }, schema: body({ identifier: str(254) }, ['identifier']) }, async (req) => {
    await auth.forgotPassword(app, req, req.body);
    return ok;
  });

  app.post('/api/auth/password/reset', { config: { rateLimit: SIGN_IN_LIMIT },
    schema: body({ token: str(100), identifier: str(254), code, password }, ['password']),
  }, async (req, reply) => {
    await auth.resetPassword(app, req, req.body);
    clearSessionCookie(reply);
    return ok;
  });

  app.post('/api/auth/password/change', { config: { rateLimit: SIGN_IN_LIMIT },
    preHandler: requireUser,
    schema: body({ currentPassword: password, newPassword: password }, ['currentPassword', 'newPassword']),
  }, async (req) => {
    await auth.changePassword(app, req, req.body);
    return ok;
  });

  app.get('/api/auth/sessions', { preHandler: requireUser }, async (req) => auth.listSessions(app, req));

  app.delete('/api/auth/sessions/:id', {
    preHandler: requireUser,
    schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } },
  }, async (req) => {
    await auth.revokeSession(app, req, req.params.id);
    return ok;
  });

  app.post('/api/auth/2fa/setup', { preHandler: requireUser }, async (req) => auth.setupTwoFactor(app, req));
  app.post('/api/auth/2fa/enable', { config: { rateLimit: SIGN_IN_LIMIT }, preHandler: requireUser, schema: body({ code }, ['code']) },
    async (req) => auth.enableTwoFactor(app, req, req.body));
  app.post('/api/auth/2fa/disable', { config: { rateLimit: SIGN_IN_LIMIT }, preHandler: requireUser, schema: body({ password }, ['password']) }, async (req) => {
    await auth.disableTwoFactor(app, req, req.body);
    return ok;
  });

  // Invitations, from the invitee's side.
  app.get('/api/invitations/:token', async (req) => team.previewInvitation(app, req, req.params.token));
  app.post('/api/invitations/accept', {
    schema: body({ token: str(100), name: str(120), password }, ['token']),
  }, async (req, reply) => {
    if (req.auth) {
      await team.acceptInvitationAsUser(app, req, req.body);
    } else {
      if (!req.body.name || !req.body.password) {
        return reply.code(400).send({ error: { code: 'missing_fields', message: 'Enter your name and a password.' } });
      }
      await team.acceptInvitation(app, req, reply, req.body);
    }
    return ok;
  });
}
