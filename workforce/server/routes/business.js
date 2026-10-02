import * as team from '../services/team.js';
import { requireMember, requirePermission } from '../auth/session.js';
import peopleRoutes from './people.js';
import schedulingRoutes from './scheduling.js';
import financeRoutes from './finance.js';
import insightRoutes from './insights.js';

const uuid = { type: 'string', format: 'uuid' };
const str = (max, min = 1) => ({ type: 'string', minLength: min, maxLength: max });
const params = (extra = {}) => ({ type: 'object', properties: { businessId: uuid, ...extra } });
const permissionChanges = { type: 'object', maxProperties: 100, additionalProperties: { type: ['boolean', 'null'] } };

// Everything under /api/b/:businessId requires an active, verified membership
// in that business. Each route then checks its own permission.
export default async function businessRoutes(app) {
  app.addHook('preHandler', requireMember);
  await app.register(peopleRoutes);
  await app.register(schedulingRoutes);
  await app.register(financeRoutes);
  await app.register(insightRoutes);
  const ok = { ok: true };

  app.get('/', { schema: { params: params() } }, async (req) => ({
    business: req.member.business,
    role: req.member.role,
    permissions: [...req.member.permissions],
  }));

  // ----- invitations -----
  app.get('/invitations', { preHandler: requirePermission('members.invite') }, async (req) => team.listInvitations(app, req));

  app.post('/invitations', {
    preHandler: requirePermission('members.invite'),
    schema: {
      params: params(),
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role'],
        properties: {
          name: str(120), email: str(254, 0), phone: str(32, 0), role: { enum: ['manager', 'employee'] },
          profile: {
            type: 'object',
            additionalProperties: false,
            properties: {
              employeeNumber: str(40, 0), jobTitle: str(80, 0), department: str(80, 0), departmentId: uuid,
              startDate: { type: 'string', format: 'date' },
              payType: { enum: ['hourly', 'salaried'] }, payRate: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  }, async (req, reply) => reply.code(201).send(await team.createInvitation(app, req, req.body)));

  app.post('/invitations/:id/resend', { preHandler: requirePermission('members.invite'), schema: { params: params({ id: uuid }) } },
    async (req) => {
      await team.resendInvitation(app, req, req.params.id);
      return ok;
    });

  app.post('/invitations/:id/revoke', { preHandler: requirePermission('members.invite'), schema: { params: params({ id: uuid }) } },
    async (req) => {
      await team.revokeInvitation(app, req, req.params.id);
      return ok;
    });

  // ----- members -----
  app.get('/members', {
    preHandler: requirePermission('members.view'),
    schema: {
      params: params(),
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: str(100, 0), role: { enum: ['owner', 'manager', 'employee'] },
          status: { enum: ['active', 'suspended', 'terminated', 'archived'] }, departmentId: uuid,
          limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: str(300),
        },
      },
    },
  }, async (req) => team.listMembers(app, req, req.query));

  app.post('/members/:membershipId/role', {
    preHandler: requirePermission('roles.assign'),
    schema: {
      params: params({ membershipId: uuid }),
      body: { type: 'object', additionalProperties: false, required: ['role'], properties: { role: { enum: ['manager', 'employee'] } } },
    },
  }, async (req) => team.changeRole(app, req, req.params.membershipId, req.body.role));

  app.post('/members/:membershipId/suspend', { preHandler: requirePermission('members.suspend'), schema: { params: params({ membershipId: uuid }) } },
    async (req) => team.setMemberStatus(app, req, req.params.membershipId, 'suspended'));

  app.post('/members/:membershipId/reactivate', { preHandler: requirePermission('members.suspend'), schema: { params: params({ membershipId: uuid }) } },
    async (req) => team.setMemberStatus(app, req, req.params.membershipId, 'active'));

  // ----- permissions -----
  app.get('/permissions', { preHandler: requirePermission('permissions.manage') }, async (req) => team.permissionMatrix(app, req));

  app.put('/permissions/:role', {
    preHandler: requirePermission('permissions.manage'),
    schema: { params: params({ role: { enum: ['manager', 'employee'] } }), body: permissionChanges },
  }, async (req) => {
    await team.setRolePermissions(app, req, req.params.role, req.body);
    return team.permissionMatrix(app, req);
  });

  app.get('/members/:membershipId/permissions', { preHandler: requirePermission('permissions.manage'), schema: { params: params({ membershipId: uuid }) } },
    async (req) => team.memberPermissions(app, req, req.params.membershipId));

  app.put('/members/:membershipId/permissions', {
    preHandler: requirePermission('permissions.manage'),
    schema: { params: params({ membershipId: uuid }), body: permissionChanges },
  }, async (req) => {
    await team.setMemberPermissions(app, req, req.params.membershipId, req.body);
    return team.memberPermissions(app, req, req.params.membershipId);
  });

  // ----- audit -----
  app.get('/audit-logs', {
    preHandler: requirePermission('audit.view'),
    schema: {
      params: params(),
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: str(80), actorId: uuid, targetType: str(40), targetId: str(80),
          from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' },
          before: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
  }, async (req) => team.listAuditLogs(app, req, req.query));
}
