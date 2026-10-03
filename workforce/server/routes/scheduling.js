import * as sched from '../services/scheduling.js';
import * as requests from '../services/requests.js';
import * as attendance from '../services/attendance.js';
import * as trips from '../services/trips.js';
import { requirePermission } from '../auth/session.js';
import { arr, bool, date, datetime, idParams, int, obj, oneOf, optStr, optUuid, params, range, str, uuid } from '../lib/schema.js';

const ok = { ok: true };
const p = (k) => requirePermission(k);

export default async function schedulingRoutes(app) {
  // ----- shifts -----
  app.get('/shifts', {
    schema: { params: params(), querystring: obj({ ...range, membershipId: uuid, departmentId: uuid, mine: bool, open: bool }, ['from', 'to']) },
  }, async (req) => sched.listShifts(app, req, req.query));
  app.get('/shifts/:id', { schema: { params: idParams } }, async (req) => sched.getShift(app, req, req.params.id));
  const shiftBody = {
    membershipId: optUuid, departmentId: optUuid, locationId: optUuid, startsAt: datetime, endsAt: datetime,
    breakMinutes: int(0, 600), notes: optStr(500), published: bool,
  };
  app.post('/shifts', { preHandler: p('schedules.manage'), schema: { params: params(), body: obj(shiftBody, ['startsAt', 'endsAt']) } },
    async (req, reply) => reply.code(201).send(await sched.createShift(app, req, req.body)));
  app.put('/shifts/:id', { preHandler: p('schedules.manage'), schema: { params: idParams, body: obj({ ...shiftBody, reason: optStr(500) }) } },
    async (req) => sched.updateShift(app, req, req.params.id, req.body));
  app.post('/shifts/:id/cancel', { preHandler: p('schedules.manage'), schema: { params: idParams, body: obj({ reason: str(500) }, ['reason']) } },
    async (req) => { await sched.cancelShift(app, req, req.params.id, req.body.reason); return ok; });
  app.post('/schedule/publish', { preHandler: p('schedules.manage'), schema: { params: params(), body: obj(range, ['from', 'to']) } },
    async (req) => sched.publish(app, req, req.body));
  app.post('/schedule/copy-week', { preHandler: p('schedules.manage'), schema: { params: params(), body: obj({ fromWeekStart: date, toWeekStart: date }, ['fromWeekStart', 'toWeekStart']) } },
    async (req) => sched.copyWeek(app, req, req.body));
  app.get('/me/week', async (req) => sched.myWeek(app, req));
  app.get('/timetable', { preHandler: p('self.schedule'), schema: { params: params(), querystring: obj({ ...range, departmentId: uuid }, ['from', 'to']) } },
    async (req) => sched.timetable(app, req, req.query));
  app.get('/staffing/today', { preHandler: p('schedules.view') }, async (req) => sched.todayStaffing(app, req));

  // ----- unavailability -----
  app.get('/unavailability', { schema: { params: params(), querystring: obj({ membershipId: uuid }) } },
    async (req) => sched.listUnavailability(app, req, req.query.membershipId));
  app.post('/unavailability', { schema: { params: params(), body: obj({ membershipId: optUuid, startsAt: datetime, endsAt: datetime, reason: optStr(200) }, ['startsAt', 'endsAt']) } },
    async (req, reply) => reply.code(201).send(await sched.addUnavailability(app, req, req.body)));
  app.delete('/unavailability/:id', { schema: { params: idParams } }, async (req) => { await sched.removeUnavailability(app, req, req.params.id); return ok; });

  // ----- requests -----
  const status = oneOf('pending', 'approved', 'rejected', 'cancelled', 'completed');
  app.get('/shift-requests', { schema: { params: params(), querystring: obj({ mine: bool, status, type: oneOf('change', 'time_off', 'offer') }) } },
    async (req) => requests.listRequests(app, req, req.query));
  app.post('/shift-requests', {
    schema: { params: params(), body: obj({ type: oneOf('change', 'time_off', 'offer'), shiftId: uuid, startsAt: datetime, endsAt: datetime, takerMembershipId: uuid, reason: optStr(500) }, ['type']) },
  }, async (req, reply) => reply.code(201).send(await requests.createRequest(app, req, req.body)));
  app.get('/shift-requests/:id', { schema: { params: idParams } }, async (req) => requests.getRequest(app, req, req.params.id));
  app.post('/shift-requests/:id/cancel', { schema: { params: idParams } }, async (req) => { await requests.cancelRequest(app, req, req.params.id); return ok; });
  app.post('/shift-requests/:id/take', { schema: { params: idParams } }, async (req) => requests.takeOffer(app, req, req.params.id));
  app.post('/shift-requests/:id/review', {
    preHandler: p('shift_requests.approve'),
    schema: { params: idParams, body: obj({ approve: bool, note: optStr(500) }, ['approve']) },
  }, async (req) => requests.reviewRequest(app, req, req.params.id, req.body));

  // ----- swaps -----
  app.get('/swaps', { schema: { params: params(), querystring: obj({ mine: bool, status: oneOf('pending_peer', 'pending_approval', 'approved', 'rejected', 'cancelled') }) } },
    async (req) => requests.listSwaps(app, req, req.query));
  app.post('/swaps', { schema: { params: params(), body: obj({ myShiftId: uuid, targetShiftId: uuid, reason: optStr(500) }, ['myShiftId', 'targetShiftId']) } },
    async (req, reply) => reply.code(201).send(await requests.createSwap(app, req, req.body)));
  app.get('/swaps/candidates/:id', { schema: { params: idParams } }, async (req) => requests.swapCandidates(app, req, req.params.id));
  app.get('/swaps/:id', { schema: { params: idParams } }, async (req) => requests.getSwap(app, req, req.params.id));
  app.post('/swaps/:id/respond', { schema: { params: idParams, body: obj({ accept: bool }, ['accept']) } },
    async (req) => requests.respondSwap(app, req, req.params.id, req.body.accept));
  app.post('/swaps/:id/cancel', { schema: { params: idParams } }, async (req) => { await requests.cancelSwap(app, req, req.params.id); return ok; });
  app.post('/swaps/:id/review', { preHandler: p('swaps.approve'), schema: { params: idParams, body: obj({ approve: bool, note: optStr(500) }, ['approve']) } },
    async (req) => requests.reviewSwap(app, req, req.params.id, req.body));

  // ----- attendance -----
  // Where the phone is and the code from the door, when the business requires it.
  const zone = { locationId: optUuid, code: optStr(12), lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 }, accuracy: { type: 'number', minimum: 0, maximum: 100000 } };
  app.post('/attendance/clock-in', { schema: { params: params(), body: obj({ note: optStr(300), ...zone }) } }, async (req) => attendance.clockIn(app, req, req.body || {}));
  app.post('/attendance/clock-out', { schema: { params: params(), body: obj({ breakMinutes: int(0, 600), note: optStr(300), ...zone }) } },
    async (req) => attendance.clockOut(app, req, req.body || {}));
  app.get('/attendance', { schema: { params: params(), querystring: obj({ ...range, membershipId: uuid, mine: bool }, ['from', 'to']) } },
    async (req) => attendance.listAttendance(app, req, req.query));
  app.get('/attendance/missed', { schema: { params: params(), querystring: obj(range, ['from', 'to']) } },
    async (req) => attendance.missedShifts(app, req, req.query));
  app.post('/attendance', {
    preHandler: p('attendance.manage'),
    schema: { params: params(), body: obj({ membershipId: uuid, shiftId: optUuid, clockIn: datetime, clockOut: { type: ['string', 'null'], format: 'date-time' }, breakMinutes: int(0, 600), note: optStr(300) }, ['membershipId', 'clockIn']) },
  }, async (req, reply) => reply.code(201).send(await attendance.addAttendance(app, req, req.body)));
  app.put('/attendance/:id', {
    preHandler: p('attendance.manage'),
    schema: { params: idParams, body: obj({ clockIn: datetime, clockOut: { type: ['string', 'null'], format: 'date-time' }, breakMinutes: int(0, 600), reason: str(500) }, ['reason']) },
  }, async (req) => attendance.adjustAttendance(app, req, req.params.id, req.body));
  app.get('/attendance/:id/history', { schema: { params: idParams } }, async (req) => attendance.attendanceHistory(app, req, req.params.id));

  // ----- delivery trips (drivers paid per trip) -----
  app.get('/trips', { schema: { params: params(), querystring: obj({ ...range, mine: bool }, ['from', 'to']) } }, async (req) => trips.listTrips(app, req, req.query));
  app.put('/trips', {
    preHandler: p('attendance.manage'),
    schema: { params: params(), body: obj({ day: date, entries: arr(obj({ membershipId: uuid, trips: int(0, 500), note: optStr(200) }, ['membershipId', 'trips']), 200) }, ['day', 'entries']) },
  }, async (req) => trips.saveTrips(app, req, req.body));
}
