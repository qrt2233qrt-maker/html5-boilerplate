import * as people from '../services/people.js';
import * as settings from '../services/settings.js';
import * as docs from '../services/documents.js';
import { requirePermission } from '../auth/session.js';
import { forbidden } from '../lib/errors.js';
import { inScope } from '../lib/context.js';
import { bool, date, idParams, int, obj, oneOf, optStr, optUuid, params, str, uuid } from '../lib/schema.js';

const ok = { ok: true };
const p = (k) => requirePermission(k);

export default async function peopleRoutes(app) {
  // ----- business settings -----
  app.get('/settings', async (req) => settings.getSettings(app, req));
  app.put('/settings', {
    preHandler: p('business.settings.manage'),
    schema: {
      params: params(),
      body: obj({
        name: str(120), timezone: str(64), locale: oneOf('ar', 'en'),
        currency: { type: 'string', pattern: '^[A-Z]{3}$' }, currencyExponent: int(0, 4),
        settings: {
          type: 'object', additionalProperties: false,
          properties: {
            auth: obj({ requirePhoneVerification: bool }),
            scheduling: obj({ maxWeeklyHours: int(1, 168), maxShiftHours: int(1, 24), minRestHours: int(0, 24) }),
            payroll: obj({ frequency: oneOf('daily', 'weekly', 'biweekly', 'monthly'), weekStartsOn: int(0, 6), overtimeWeeklyHours: int(1, 168), overtimeMultiplier: { type: 'number', minimum: 1, maximum: 3 } }),
            approvals: obj({ expenseOwnerOver: int(0, 1e15) }),
            attendance: obj({ requireZone: bool, method: oneOf('qr', 'gps', 'either'), checkLocation: bool, typedCode: bool }),
            alerts: obj({ payrollIncreasePct: int(1, 1000), categoryIncreasePct: int(1, 1000), revenueDropPct: int(1, 100), overtimeIncreasePct: int(1, 1000), marginBelowPct: int(-100, 100), largeExpense: int(1, 1e15) }),
          },
        },
      }),
    },
  }, async (req) => {
    // Security settings belong to the owner alone.
    if (req.body.settings?.auth && !req.member.permissions.has('security.manage')) throw forbidden();
    return settings.updateSettings(app, req, req.body);
  });

  // ----- departments and locations -----
  app.get('/departments', async (req) => settings.listDepartments(app, req));
  const deptBody = obj({ name: str(80), managerId: optUuid, archived: bool });
  app.post('/departments', { preHandler: p('departments.manage'), schema: { params: params(), body: { ...deptBody, required: ['name'] } } },
    async (req, reply) => reply.code(201).send(await settings.saveDepartment(app, req, null, req.body)));
  app.put('/departments/:id', { preHandler: p('departments.manage'), schema: { params: idParams, body: deptBody } },
    async (req) => settings.saveDepartment(app, req, req.params.id, req.body));

  app.get('/locations', async (req) => settings.listLocations(app, req));
  const nullableNum = (min, max) => ({ type: ['number', 'null'], minimum: min, maximum: max });
  const locBody = obj({
    name: str(80), address: optStr(200), archived: bool,
    latitude: nullableNum(-90, 90), longitude: nullableNum(-180, 180), radiusM: int(20, 2000), doorMode: oneOf('screen', 'daily'),
  });
  app.post('/locations', { preHandler: p('schedules.manage'), schema: { params: params(), body: { ...locBody, required: ['name'] } } },
    async (req, reply) => reply.code(201).send(await settings.saveLocation(app, req, null, req.body)));
  app.put('/locations/:id', { preHandler: p('schedules.manage'), schema: { params: idParams, body: locBody } },
    async (req) => settings.saveLocation(app, req, req.params.id, req.body));
  // The door code (QR) for clocking in; managers open it on the door tablet.
  app.get('/locations/:id/door', { preHandler: p('attendance.manage'), schema: { params: idParams } }, async (req) => settings.doorCode(app, req, req.params.id));
  app.post('/locations/:id/door/reset', { preHandler: p('schedules.manage'), schema: { params: idParams } }, async (req) => settings.resetDoorCode(app, req, req.params.id));

  app.post('/setup/restaurant', { preHandler: p('business.settings.manage'), schema: { params: params() } },
    async (req) => settings.applyRestaurant(app, req));

  // ----- categories -----
  const catType = { type: oneOf('expense', 'revenue') };
  app.get('/categories/:type', { schema: { params: params(catType) } }, async (req) => settings.listCategories(app, req, req.params.type));
  const catBody = obj({ nameEn: str(80), nameAr: str(80), kind: oneOf('fixed', 'operating', 'payroll', 'other', 'sale', 'service', 'refund', 'adjustment'), icon: str(8), employeeClaimable: bool, archived: bool });
  app.post('/categories/:type', { preHandler: p('business.settings.manage'), schema: { params: params(catType), body: catBody } },
    async (req, reply) => reply.code(201).send(await settings.saveCategory(app, req, req.params.type, null, req.body)));
  app.put('/categories/:type/:id', { preHandler: p('business.settings.manage'), schema: { params: params({ ...catType, id: uuid }), body: catBody } },
    async (req) => settings.saveCategory(app, req, req.params.type, req.params.id, req.body));

  // ----- people -----
  const mid = params({ membershipId: uuid });
  app.get('/members/:membershipId', { schema: { params: mid } }, async (req) => people.getMember(app, req, req.params.membershipId));
  app.put('/members/:membershipId', {
    schema: {
      params: mid,
      body: obj({
        profile: obj({ employeeNumber: optStr(40), jobTitle: optStr(80), startDate: { type: ['string', 'null'], format: 'date' }, workPhone: optStr(32), notes: optStr(1000) }),
        departmentId: optUuid, reportsTo: optUuid,
        sensitive: obj({ emergencyName: optStr(120), emergencyPhone: optStr(32), emergencyRelation: optStr(60), nationalId: optStr(60), address: optStr(300), birthDate: { type: ['string', 'null'], format: 'date' } }),
      }),
    },
  }, async (req) => people.updateMember(app, req, req.params.membershipId, req.body));

  app.get('/members/:membershipId/pay-rates', { schema: { params: mid } }, async (req) => people.listPayRates(app, req, req.params.membershipId));
  app.post('/members/:membershipId/pay-rates', {
    preHandler: p('payroll.manage'),
    schema: { params: mid, body: obj({ payType: oneOf('hourly', 'salaried', 'per_trip'), rate: int(0, 1e15), effectiveFrom: date, note: optStr(200), frequency: { enum: ['daily', 'weekly', 'biweekly', 'monthly', null] } }, ['payType', 'rate', 'effectiveFrom']) },
  }, async (req, reply) => reply.code(201).send(await people.addPayRate(app, req, req.params.membershipId, req.body)));

  app.post('/members/:membershipId/terminate', {
    preHandler: p('members.terminate'),
    schema: { params: mid, body: obj({ endDate: date, reason: str(500) }, ['endDate', 'reason']) },
  }, async (req) => people.terminate(app, req, req.params.membershipId, req.body));
  app.post('/members/:membershipId/reinstate', { preHandler: p('members.terminate'), schema: { params: mid } },
    async (req) => { await people.reinstate(app, req, req.params.membershipId); return ok; });
  app.post('/members/:membershipId/archive', { preHandler: p('members.terminate'), schema: { params: mid } },
    async (req) => { await people.archiveMember(app, req, req.params.membershipId); return ok; });
  app.post('/members/:membershipId/delete', {
    preHandler: p('records.hard_delete'),
    schema: { params: mid, body: obj({ confirm: str(120), reason: str(500) }, ['confirm', 'reason']) },
  }, async (req) => { await people.deleteMember(app, req, req.params.membershipId, req.body); return ok; });

  // ----- documents -----
  // Files arrive base64-encoded (4 bytes for every 3), plus a little JSON.
  const uploadBody = Math.ceil((app.config.maxUploadBytes * 4) / 3) + 64 * 1024;
  app.post('/documents', {
    bodyLimit: uploadBody,
    schema: {
      params: params(),
      body: obj({ data: { type: 'string', maxLength: uploadBody }, filename: str(120), kind: oneOf('receipt', 'contract', 'document'), membershipId: optUuid }, ['data', 'filename', 'kind']),
    },
  }, async (req, reply) => {
    const { membershipId, kind } = req.body;
    // Contracts and HR documents for someone else need people-management rights.
    if (membershipId && membershipId !== req.member.id) {
      if (!req.member.permissions.has('members.edit') || !(await inScope(req, membershipId))) throw forbidden();
    } else if (kind !== 'receipt' && !membershipId) {
      if (!req.member.permissions.has('business_expenses.manage')) throw forbidden();
    }
    return reply.code(201).send(await docs.saveUpload(app, req, app.db, req.body));
  });
  app.get('/documents/:id', { schema: { params: idParams, querystring: obj({ download: bool }) } }, async (req, reply) => {
    const { doc, buf } = await docs.readDocument(app, req, req.params.id);
    const inline = !req.query.download && /^(image\/|application\/pdf)/.test(doc.mime);
    reply.header('Content-Type', doc.mime);
    reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
    // Files are shown as-is, never run as a page.
    reply.header('Content-Security-Policy', 'sandbox; default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(buf);
  });
  app.get('/members/:membershipId/documents', { schema: { params: mid } }, async (req) => {
    if (req.params.membershipId !== req.member.id && !(req.member.permissions.has('members.view_sensitive') && (await inScope(req, req.params.membershipId)))) throw forbidden();
    return docs.listMemberDocuments(app, req, req.params.membershipId);
  });
  app.delete('/documents/:id', { schema: { params: idParams } }, async (req) => { await docs.archiveDocument(app, req, req.params.id); return ok; });
}

