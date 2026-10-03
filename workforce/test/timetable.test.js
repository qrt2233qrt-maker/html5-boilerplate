import assert from 'node:assert/strict';
import { addMember, ownerWithBusiness, setup } from './helpers.js';

// A day in the future at an hour (UTC).
const at = (days, hour) => { const d = new Date(Date.now() + days * 864e5); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const day = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

describe('team timetable', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('shows everyone the whole team\'s published shifts, with a colour each, and lets them ask to swap', async () => {
    const { owner, businessId } = await ownerWithBusiness(t, { businessName: 'PizzaRita' });
    const B = (p) => `/api/b/${businessId}${p}`;
    const z = await addMember(t, owner, businessId, { email: 'zainab@pizzarita.test', name: 'Zainab' });
    const a = await addMember(t, owner, businessId, { email: 'ali@pizzarita.test', name: 'Ali' });
    const mine = (await owner.post(B('/shifts'), { membershipId: z.membershipId, startsAt: at(2, 6), endsAt: at(2, 14), published: true })).body;
    const his = (await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: at(3, 6), endsAt: at(3, 14), published: true })).body;
    await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: at(4, 6), endsAt: at(4, 14), published: false });

    const r = await z.member.get(B(`/timetable?from=${day(0)}&to=${day(6)}`));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Zainab sees Ali's published shift, not his draft, and no notes or pay.
    assert.deepEqual(r.body.shifts.map((s) => s.id).sort(), [mine.id, his.id].sort());
    assert.ok(!('notes' in r.body.shifts[0]));
    const colors = r.body.people.map((p) => p.color);
    assert.equal(new Set(colors).size, colors.length);
    assert.equal(r.body.people[0].membershipId, z.membershipId);
    assert.ok(!('email' in r.body.people[0]) && !('pay' in r.body.people[0]));

    // Straight from the timetable: ask Ali to swap.
    const sw = await z.member.post(B('/swaps'), { myShiftId: mine.id, targetShiftId: his.id, reason: 'Exam' });
    assert.equal(sw.status, 201, JSON.stringify(sw.body));
    const after = (await a.member.get(B(`/timetable?from=${day(0)}&to=${day(6)}`))).body;
    assert.ok(after.shifts.find((s) => s.id === his.id).swapPending);
    // Ranges are limited.
    assert.equal((await z.member.get(B(`/timetable?from=${day(0)}&to=${day(90)}`))).status, 400);
  });
});
