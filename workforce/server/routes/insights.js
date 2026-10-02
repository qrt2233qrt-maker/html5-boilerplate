import * as analytics from '../services/analytics.js';
import * as notes from '../services/notifications.js';
import * as reports from '../services/reports.js';
import { search } from '../services/search.js';
import { importExpensesApp } from '../services/importer.js';
import { requirePermission } from '../auth/session.js';
import { arr, bool, date, datetime, idParams, int, obj, oneOf, params, range, str, uuid } from '../lib/schema.js';

const ok = { ok: true };
const p = (k) => requirePermission(k);
const reportFilters = { ...range, departmentId: uuid, membershipId: uuid, categoryId: uuid };

export default async function insightRoutes(app) {
  // ----- analytics -----
  app.get('/analytics/overview', { preHandler: p('finance.view'), schema: { params: params(), querystring: obj({ ...range, bucket: oneOf('day', 'week', 'month') }, ['from', 'to']) } },
    async (req) => analytics.overview(app, req, req.query));
  app.get('/analytics/expenses/:key', { preHandler: p('finance.view'), schema: { params: params({ key: str(80) }), querystring: obj(range, ['from', 'to']) } },
    async (req) => analytics.drilldown(app, req, req.params.key, req.query));
  app.get('/analytics/workforce', { preHandler: p('analytics.view'), schema: { params: params(), querystring: obj(range, ['from', 'to']) } },
    async (req) => analytics.workforce(app, req, req.query));
  app.get('/alerts', { preHandler: p('finance.view') }, async (req) => analytics.listAlerts(app, req));
  app.post('/alerts/dismiss', { preHandler: p('finance.view'), schema: { params: params(), body: obj({ key: str(200) }, ['key']) } },
    async (req) => { await analytics.dismissAlert(app, req, req.body.key); return ok; });

  // ----- notifications -----
  app.get('/notifications', { schema: { params: params(), querystring: obj({ before: datetime, limit: int(1, 100), unread: bool }) } },
    async (req) => notes.listNotifications(app, req, req.query));
  app.post('/notifications/:id/read', { schema: { params: idParams } }, async (req) => { await notes.markRead(app, req, req.params.id); return ok; });
  app.post('/notifications/read-all', async (req) => { await notes.markAllRead(app, req); return ok; });
  app.get('/notification-preferences', async (req) => notes.getPrefs(app, req));
  app.put('/notification-preferences', { schema: { params: params(), body: obj({ email: bool, sms: bool }) } },
    async (req) => notes.setPrefs(app, req, req.body));

  // ----- reports -----
  app.get('/reports', async (req) => reports.availableReports(req));
  app.get('/reports/:type', { schema: { params: params({ type: str(40) }), querystring: obj(reportFilters, ['from', 'to']) } },
    async (req) => reports.runReport(app, req, req.params.type, req.query));
  app.post('/reports/:type/export', {
    schema: { params: params({ type: str(40) }), body: obj({ ...reportFilters, format: oneOf('csv', 'xlsx'), locale: oneOf('ar', 'en') }, ['from', 'to', 'format']) },
  }, async (req, reply) => reply.code(202).send(await reports.requestExport(app, req, req.params.type, req.body)));
  app.get('/report-exports/:id', { schema: { params: idParams } }, async (req) => reports.getExport(app, req, req.params.id));

  // ----- search -----
  app.get('/search', { schema: { params: params(), querystring: obj({ q: str(100, 0) }) } }, async (req) => search(app, req, req.query.q));

  // ----- import from the existing expenses app (owner only) -----
  app.post('/import/expenses-app', {
    preHandler: p('owners.manage'),
    bodyLimit: 20 * 1024 * 1024,
    schema: {
      params: params(),
      body: {
        type: 'object',
        properties: {
          expenses: arr({ type: 'object', required: ['uid', 'id', 'amount', 'date'], properties: { uid: str(200), id: str(200), amount: { type: 'number', minimum: 0 }, categoryId: str(80, 0), date, vendor: { type: ['string', 'null'] }, method: { type: ['string', 'null'] }, note: { type: ['string', 'null'] } } }, 100000),
          approvals: { type: 'object' }, payrollRuns: { type: 'object' }, payrollEmployees: { type: 'object' }, people: { type: 'object' },
        },
      },
    },
  }, async (req) => importExpensesApp(app, req, req.body));
}
