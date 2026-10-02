import assert from 'node:assert/strict';
import { PASSWORD, addMember, client, ownerWithBusiness, setup } from './helpers.js';

// ISO time `days` from today (UTC) at `hour`:00.
function at(days, hour, minute = 0) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, minute);
  return d.toISOString();
}
const day = (days) => at(days, 0).slice(0, 10);
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');

async function team(t) {
  const o = await ownerWithBusiness(t);
  const a = await addMember(t, o.owner, o.businessId, { email: 'a@example.com', name: 'Ali Employee' });
  const b = await addMember(t, o.owner, o.businessId, { email: 'b@example.com', name: 'Bushra Employee' });
  const m = await addMember(t, o.owner, o.businessId, { email: 'm@example.com', name: 'Mona Manager', role: 'manager' });
  const B = (p) => `/api/b/${o.businessId}${p}`;
  return { ...o, a, b, m, B };
}

describe('people (phase 2)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('creates departments and limits a department manager to their own people', async () => {
    const { owner, a, b, m, B } = await team(t);
    const dept = (await owner.post(B('/departments'), { name: 'Bakery', managerId: m.membershipId })).body;
    await owner.put(B(`/members/${a.membershipId}`), { departmentId: dept.id });
    const seen = (await m.member.get(B('/members'))).body.items.map((x) => x.name);
    assert.ok(seen.includes('Ali Employee'));
    assert.ok(!seen.includes('Bushra Employee'), 'manager only sees their department');
    assert.equal((await m.member.get(B(`/members/${b.membershipId}`))).status, 404);
    const dup = await owner.post(B('/departments'), { name: 'bakery' });
    assert.equal(dup.status, 409);
  });

  it('encrypts personal details and lets employees edit only their own contact details', async () => {
    const { owner, a, B } = await team(t);
    const own = await a.member.put(B(`/members/${a.membershipId}`), { sensitive: { emergencyName: 'Fatima', emergencyPhone: '+9647700000000' } });
    assert.equal(own.status, 200);
    assert.equal(own.body.sensitive.emergencyName, 'Fatima');
    const { rows: [r] } = await t.pool.query('SELECT sensitive_enc FROM memberships WHERE id = $1', [a.membershipId]);
    assert.ok(!r.sensitive_enc.includes('Fatima'), 'stored encrypted');
    assert.equal((await a.member.put(B(`/members/${a.membershipId}`), { profile: { jobTitle: 'CEO' } })).status, 403);
    assert.equal((await owner.get(B(`/members/${a.membershipId}`))).body.sensitive.emergencyName, 'Fatima');
  });

  it('keeps every pay rate instead of overwriting', async () => {
    const { owner, a, B } = await team(t);
    await owner.post(B(`/members/${a.membershipId}/pay-rates`), { payType: 'hourly', rate: 5000, effectiveFrom: day(-30) });
    await owner.post(B(`/members/${a.membershipId}/pay-rates`), { payType: 'hourly', rate: 6000, effectiveFrom: day(0) });
    const rates = (await owner.get(B(`/members/${a.membershipId}/pay-rates`))).body;
    assert.deepEqual(rates.map((x) => x.rate), [6000, 5000]);
    assert.equal((await owner.get(B(`/members/${a.membershipId}`))).body.pay.rate, 6000);
    // Employees see their own pay, never a colleague's.
    assert.equal((await a.member.get(B(`/members/${a.membershipId}/pay-rates`))).status, 200);
    assert.equal((await a.member.post(B(`/members/${a.membershipId}/pay-rates`), { payType: 'hourly', rate: 9, effectiveFrom: day(0) })).status, 403);
  });

  it('terminates without deleting history: login disabled, future shifts cancelled', async () => {
    const { owner, a, B } = await team(t);
    const shift = (await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: at(2, 6), endsAt: at(2, 14), published: true })).body;
    const res = await owner.post(B(`/members/${a.membershipId}/terminate`), { endDate: day(0), reason: 'Moved city' });
    assert.equal(res.body.shiftsCancelled, 1);
    assert.equal((await a.member.get('/api/auth/me')).status, 401, 'sessions revoked');
    const login = await client(t.app).post('/api/auth/login', { identifier: 'a@example.com', password: PASSWORD });
    assert.equal(login.body.error.code, 'access_suspended');
    const s = (await owner.get(B(`/shifts/${shift.id}`))).body;
    assert.equal(s.status, 'cancelled');
    assert.ok(s.history.some((h) => h.changeType === 'cancelled' && h.reason === 'Employment ended'));
    const member = (await owner.get(B(`/members/${a.membershipId}`))).body;
    assert.equal(member.status, 'terminated');
  });

  it('permanently deletes only archived people with no records, with typed confirmation', async () => {
    const { owner, a, B } = await team(t);
    await owner.post(B(`/members/${a.membershipId}/terminate`), { endDate: day(0), reason: 'Left' });
    assert.equal((await owner.post(B(`/members/${a.membershipId}/delete`), { confirm: 'Ali Employee', reason: 'x' })).body.error.code, 'invalid_status');
    await owner.post(B(`/members/${a.membershipId}/archive`));
    assert.equal((await owner.post(B(`/members/${a.membershipId}/delete`), { confirm: 'ali', reason: 'x' })).body.error.code, 'confirm_mismatch');
    assert.equal((await owner.post(B(`/members/${a.membershipId}/delete`), { confirm: 'Ali Employee', reason: 'Data request' })).status, 200);
    const log = (await owner.get(B('/audit-logs?action=member.deleted'))).body.items[0];
    assert.equal(log.before.name, 'Ali Employee');
    assert.equal(log.after.reason, 'Data request');
  });

  it('accepts real images, rejects disguised files, and keeps files private', async () => {
    const { owner, a, b, B } = await team(t);
    const fake = await a.member.post(B('/documents'), { data: Buffer.from('<script>alert(1)</script>').toString('base64'), filename: 'photo.png', kind: 'receipt' });
    assert.equal(fake.body.error.code, 'file_type');
    const ok = await a.member.post(B('/documents'), { data: PNG, filename: '../../etc/passwd.png', kind: 'receipt' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.mime, 'image/png');
    assert.ok(!ok.body.filename.includes('/'));
    assert.equal((await b.member.get(B(`/documents/${ok.body.id}`))).status, 403);
    const raw = await t.app.inject({ method: 'GET', url: B(`/documents/${ok.body.id}`), headers: { cookie: owner.cookie } });
    assert.equal(raw.statusCode, 200);
    assert.match(raw.headers['content-security-policy'], /sandbox/);
  });
});

describe('scheduling (phase 3)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('rejects overlapping shifts, too little rest and too many weekly hours', async () => {
    const { owner, a, B } = await team(t);
    assert.equal((await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: at(1, 6), endsAt: at(1, 14) })).status, 201);
    const overlap = await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: at(1, 12), endsAt: at(1, 18) });
    assert.equal(overlap.body.error.code, 'schedule_conflict');
    assert.equal(overlap.body.error.details.problems[0].rule, 'overlap');
    const rest = await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: at(1, 16), endsAt: at(1, 20) });
    assert.equal(rest.body.error.details.problems[0].rule, 'rest');
    await owner.put(B('/settings'), { settings: { scheduling: { maxWeeklyHours: 10 } } });
    const hours = await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: at(1, 23), endsAt: at(2, 7) });
    assert.ok(hours.body.error.details.problems.some((p) => p.rule === 'weekly_hours'));
  });

  it('respects unavailability', async () => {
    const { owner, a, B } = await team(t);
    await a.member.post(B('/unavailability'), { startsAt: at(3, 0), endsAt: at(4, 0), reason: 'Exam' });
    const res = await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: at(3, 8), endsAt: at(3, 12) });
    assert.equal(res.body.error.details.problems[0].rule, 'unavailable');
  });

  it('shows employees only published shifts and keeps a history of changes', async () => {
    const { owner, a, B } = await team(t);
    const s = (await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: at(1, 6), endsAt: at(1, 14) })).body;
    const q = `/shifts?from=${day(0)}&to=${day(7)}`;
    assert.equal((await a.member.get(B(q))).body.length, 0, 'drafts are hidden');
    const pub = await owner.post(B('/schedule/publish'), { from: day(0), to: day(7) });
    assert.equal(pub.body.published, 1);
    assert.equal((await a.member.get(B(q))).body.length, 1);
    await owner.put(B(`/shifts/${s.id}`), { startsAt: at(1, 7), endsAt: at(1, 15), reason: 'Delivery moved' });
    const full = (await owner.get(B(`/shifts/${s.id}`))).body;
    const upd = full.history.find((h) => h.changeType === 'updated');
    assert.equal(upd.reason, 'Delivery moved');
    assert.equal(new Date(upd.before.startsAt).toISOString(), at(1, 6));
    assert.equal(new Date(upd.after.startsAt).toISOString(), at(1, 7));
    assert.ok(full.rescheduled);
    const types = (await t.pool.query('SELECT type FROM notifications WHERE user_id = (SELECT user_id FROM memberships WHERE id = $1)', [a.membershipId])).rows.map((r) => r.type);
    assert.ok(types.includes('schedule.published') && types.includes('shift.changed'));
  });

  it('stops employees from building the schedule', async () => {
    const { a, B } = await team(t);
    assert.equal((await a.member.post(B('/shifts'), { startsAt: at(1, 6), endsAt: at(1, 14) })).status, 403);
  });
});

describe('requests and swaps (phase 4)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  async function published(ctx, membershipId, d, h1, h2) {
    const s = (await ctx.owner.post(ctx.B('/shifts'), { membershipId, startsAt: at(d, h1), endsAt: at(d, h2), published: true })).body;
    assert.ok(s.id, JSON.stringify(s));
    return s;
  }

  it('runs a swap end to end: colleague accepts, manager approves, both schedules change', async () => {
    const ctx = await team(t);
    const { a, b, m, B } = ctx;
    const mon = await published(ctx, a.membershipId, 2, 6, 14);
    const wed = await published(ctx, b.membershipId, 4, 10, 18);
    const sw = (await a.member.post(B('/swaps'), { myShiftId: mon.id, targetShiftId: wed.id, reason: 'Doctor visit' })).body;
    assert.equal(sw.status, 'pending_peer');
    // The manager can't approve before the colleague agrees.
    assert.equal((await m.member.post(B(`/swaps/${sw.id}/review`), { approve: true })).body.error.code, 'not_pending');
    assert.equal((await b.member.post(B(`/swaps/${sw.id}/respond`), { accept: true })).body.status, 'pending_approval');
    // Neither person in the swap can approve it.
    assert.equal((await a.member.post(B(`/swaps/${sw.id}/review`), { approve: true })).status, 403);
    const done = await m.member.post(B(`/swaps/${sw.id}/review`), { approve: true });
    assert.equal(done.body.status, 'approved');
    assert.equal((await ctx.owner.get(B(`/shifts/${mon.id}`))).body.membershipId, b.membershipId);
    const wedFull = (await ctx.owner.get(B(`/shifts/${wed.id}`))).body;
    assert.equal(wedFull.membershipId, a.membershipId);
    assert.equal(wedFull.history.at(-1).changeType, 'swapped');
    assert.equal(wedFull.history.at(-1).requestId, sw.id);
    const notes = (await t.pool.query('SELECT count(*)::int AS n FROM notifications WHERE type = \'swap.approved\'')).rows[0].n;
    assert.equal(notes, 2, 'both employees are told');
  });

  it('refuses swaps that would overlap another shift', async () => {
    const ctx = await team(t);
    const { a, b, B } = ctx;
    const mine = await published(ctx, a.membershipId, 2, 6, 10);
    await published(ctx, a.membershipId, 4, 6, 10);
    const theirs = await published(ctx, b.membershipId, 4, 8, 12);
    const res = await a.member.post(B('/swaps'), { myShiftId: mine.id, targetShiftId: theirs.id });
    assert.equal(res.body.error.code, 'schedule_conflict');
  });

  it('approves a shift change request and records it on the shift', async () => {
    const ctx = await team(t);
    const { a, m, B } = ctx;
    const s = await published(ctx, a.membershipId, 2, 6, 14);
    const r = (await a.member.post(B('/shift-requests'), { type: 'change', shiftId: s.id, startsAt: at(2, 8), endsAt: at(2, 16), reason: 'School run' })).body;
    assert.equal(r.status, 'pending');
    assert.equal((await a.member.post(B(`/shift-requests/${r.id}/review`), { approve: true })).status, 403);
    assert.equal((await m.member.post(B(`/shift-requests/${r.id}/review`), { approve: true })).body.status, 'approved');
    const full = (await ctx.owner.get(B(`/shifts/${s.id}`))).body;
    assert.equal(new Date(full.startsAt).toISOString(), at(2, 8));
    assert.equal(full.history.at(-1).requestType, 'change');
  });

  it('approved time off opens up the shifts inside it', async () => {
    const ctx = await team(t);
    const { a, m, B } = ctx;
    const s = await published(ctx, a.membershipId, 3, 6, 14);
    const r = (await a.member.post(B('/shift-requests'), { type: 'time_off', startsAt: at(3, 0), endsAt: at(4, 0), reason: 'Family' })).body;
    await m.member.post(B(`/shift-requests/${r.id}/review`), { approve: true });
    assert.equal((await ctx.owner.get(B(`/shifts/${s.id}`))).body.membershipId, null);
    // And the period is now blocked for scheduling.
    const again = await ctx.owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: at(3, 8), endsAt: at(3, 10) });
    assert.equal(again.body.error.code, 'schedule_conflict');
  });

  it('lets an employee give away a shift that a colleague takes', async () => {
    const ctx = await team(t);
    const { a, b, m, B } = ctx;
    const s = await published(ctx, a.membershipId, 2, 6, 14);
    const r = (await a.member.post(B('/shift-requests'), { type: 'offer', shiftId: s.id })).body;
    assert.equal((await b.member.post(B(`/shift-requests/${r.id}/take`))).body.takerMembershipId, b.membershipId);
    await m.member.post(B(`/shift-requests/${r.id}/review`), { approve: true });
    assert.equal((await ctx.owner.get(B(`/shifts/${s.id}`))).body.membershipId, b.membershipId);
  });

  it('cancels a pending request but not a decided one', async () => {
    const ctx = await team(t);
    const { a, m, B } = ctx;
    const s = await published(ctx, a.membershipId, 2, 6, 14);
    const r = (await a.member.post(B('/shift-requests'), { type: 'change', shiftId: s.id, startsAt: at(2, 7), endsAt: at(2, 15) })).body;
    await m.member.post(B(`/shift-requests/${r.id}/review`), { approve: false, note: 'Busy day' });
    assert.equal((await a.member.post(B(`/shift-requests/${r.id}/cancel`))).body.error.code, 'not_pending');
    const r2 = (await a.member.post(B('/shift-requests'), { type: 'change', shiftId: s.id, startsAt: at(2, 7), endsAt: at(2, 15) })).body;
    assert.equal((await a.member.post(B(`/shift-requests/${r2.id}/cancel`))).status, 200);
  });
});

describe('attendance (phase 5)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('clocks in and out once at a time, and shows the week to the employee', async () => {
    const { owner, a, B } = await team(t);
    const now = new Date();
    await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(+now + 4 * 3600000).toISOString(), published: true });
    const inRes = await a.member.post(B('/attendance/clock-in'));
    assert.ok(inRes.body.shiftId, 'linked to the running shift');
    assert.equal((await a.member.post(B('/attendance/clock-in'))).body.error.code, 'already_clocked_in');
    const week = (await a.member.get(B('/me/week'))).body;
    assert.ok(week.clockedIn);
    assert.equal(week.today.length, 1);
    const outRes = await a.member.post(B('/attendance/clock-out'), { breakMinutes: 0 });
    assert.ok(outRes.body.clockOut);
  });

  it('records manager corrections with history and lists missed shifts', async () => {
    const { owner, a, m, B } = await team(t);
    // A past shift nobody clocked into (inserted directly; the API won't schedule the past through rules).
    await t.pool.query(
      'INSERT INTO shifts (business_id, membership_id, starts_at, ends_at, published) VALUES ($1, $2, $3, $4, true)',
      [owner && (await owner.refresh()).businesses[0].id, a.membershipId, at(-2, 6), at(-2, 14)]);
    const missed = (await m.member.get(B(`/attendance/missed?from=${day(-7)}&to=${day(0)}`))).body;
    assert.equal(missed.length, 1);
    const rec = (await m.member.post(B('/attendance'), { membershipId: a.membershipId, clockIn: at(-2, 6, 5), clockOut: at(-2, 14) })).body;
    const fixed = await m.member.put(B(`/attendance/${rec.id}`), { clockIn: at(-2, 6), reason: 'Card reader was down' });
    assert.equal(fixed.status, 200);
    const hist = (await owner.get(B(`/attendance/${rec.id}/history`))).body;
    assert.deepEqual(hist.map((h) => h.changeType), ['created', 'adjusted']);
    assert.equal(hist[1].reason, 'Card reader was down');
    assert.equal((await a.member.post(B('/attendance'), { membershipId: a.membershipId, clockIn: at(-1, 6) })).status, 403);
  });

  it('gives managers a live view of today', async () => {
    const { owner, a, m, B } = await team(t);
    const now = Date.now();
    await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(now + 3600000).toISOString(), published: true });
    const today = (await m.member.get(B('/staffing/today'))).body;
    assert.equal(today.totals.late, 1);
    await a.member.post(B('/attendance/clock-in'));
    assert.equal((await m.member.get(B('/staffing/today'))).body.totals.working, 1);
  });
});
