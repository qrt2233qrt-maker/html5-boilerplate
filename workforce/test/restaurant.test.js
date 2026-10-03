import assert from 'node:assert/strict';
import { addMember, ownerWithBusiness, setup } from './helpers.js';
import { currentDoorCode, distanceM } from '../server/lib/geo.js';

// PizzaRita, Karrada (Baghdad), and points around it.
const SHOP = { lat: 33.3009, lng: 44.4141 };
const north = (m) => ({ lat: SHOP.lat + m / 111320, lng: SHOP.lng });

async function restaurant(t) {
  const o = await ownerWithBusiness(t, { businessName: 'PizzaRita' });
  const B = (p) => `/api/b/${o.businessId}${p}`;
  const cook = await addMember(t, o.owner, o.businessId, { email: 'cook@pizzarita.test', name: 'Hassan Cook' });
  const mgr = await addMember(t, o.owner, o.businessId, { email: 'mgr@pizzarita.test', name: 'Omar Manager', role: 'manager' });
  return { ...o, B, cook, mgr };
}

async function codeNow(t, locationId, at = Date.now()) {
  const { rows: [loc] } = await t.pool.query('SELECT * FROM locations WHERE id = $1', [locationId]);
  return currentDoorCode(loc, 'Asia/Baghdad', at).code;
}

describe('clock-in zone (PizzaRita)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('measures distance on the earth correctly', () => {
    const d = distanceM(SHOP.lat, SHOP.lng, north(457).lat, SHOP.lng);
    assert.ok(Math.abs(d - 457) < 2, `got ${d}`);
  });

  it('lets staff clock in freely until the restaurant sets its position', async () => {
    const { cook, B } = await restaurant(t);
    assert.equal((await cook.member.post(B('/attendance/clock-in'))).status, 200);
    assert.equal((await cook.member.get(B('/me/week'))).body.zoneRequired, false);
  });

  it('requires the door code and being inside the zone, for clock-in and clock-out', async () => {
    const { owner, cook, mgr, B } = await restaurant(t);
    const loc = (await owner.post(B('/locations'), { name: 'PizzaRita Karrada', latitude: SHOP.lat, longitude: SHOP.lng, radiusM: 100 })).body;
    assert.equal(loc.radiusM, 100);
    assert.equal((await cook.member.get(B('/me/week'))).body.zoneRequired, true);

    // No code at all.
    let r = await cook.member.post(B('/attendance/clock-in'), { ...north(10), accuracy: 15 });
    assert.equal(r.body.error.code, 'zone_required');
    // Wrong code.
    r = await cook.member.post(B('/attendance/clock-in'), { locationId: loc.id, code: '000000', ...north(10), accuracy: 15 });
    assert.equal(r.body.error.code, 'invalid_door_code');
    // Right code, but about 500 yards away (someone sent them a photo of the QR).
    const code = await codeNow(t, loc.id);
    r = await cook.member.post(B('/attendance/clock-in'), { locationId: loc.id, code, ...north(457), accuracy: 12 });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'outside_zone');
    assert.ok(Math.abs(r.body.error.details.distance - 457) < 3);
    // Right code, phone too unsure of where it is.
    r = await cook.member.post(B('/attendance/clock-in'), { locationId: loc.id, code, ...north(20), accuracy: 900 });
    assert.equal(r.body.error.code, 'location_inaccurate');
    // No position at all.
    r = await cook.member.post(B('/attendance/clock-in'), { locationId: loc.id, code });
    assert.equal(r.body.error.code, 'location_needed');
    // Inside, with the code typed in Arabic-Indic digits.
    const arabic = code.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
    r = await cook.member.post(B('/attendance/clock-in'), { locationId: loc.id, code: arabic, ...north(40), accuracy: 18 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Clock-out needs the door too.
    r = await cook.member.post(B('/attendance/clock-out'), { breakMinutes: 0 });
    assert.equal(r.body.error.code, 'zone_required');
    r = await cook.member.post(B('/attendance/clock-out'), { breakMinutes: 0, locationId: loc.id, code: await codeNow(t, loc.id), ...north(30), accuracy: 10 });
    assert.equal(r.status, 200);
    // The manager sees where each clock-in happened.
    const day = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const list = (await mgr.member.get(B(`/attendance?from=${from}&to=${day}&membershipId=${cook.membershipId}`))).body;
    const rec = list[0];
    assert.equal(rec.locationName, 'PizzaRita Karrada');
    assert.ok(rec.inDistanceM >= 35 && rec.inDistanceM <= 45, `in ${rec.inDistanceM}`);
  });

  it('accepts the code from just before it changed, but not older ones', async () => {
    const { owner, cook, B } = await restaurant(t);
    const loc = (await owner.post(B('/locations'), { name: 'PizzaRita', latitude: SHOP.lat, longitude: SHOP.lng })).body;
    const previous = await codeNow(t, loc.id, Date.now() - 60000);
    const old = await codeNow(t, loc.id, Date.now() - 180000);
    assert.equal((await cook.member.post(B('/attendance/clock-in'), { locationId: loc.id, code: old, ...north(5), accuracy: 5 })).body.error?.code, old === previous ? undefined : 'invalid_door_code');
    assert.equal((await cook.member.post(B('/attendance/clock-in'), { locationId: loc.id, code: previous, ...north(5), accuracy: 5 })).status, 200);
  });

  it('shows managers the door QR, supports a printed daily code, and can reset it', async () => {
    const { owner, cook, mgr, B } = await restaurant(t);
    const loc = (await owner.post(B('/locations'), { name: 'PizzaRita', latitude: SHOP.lat, longitude: SHOP.lng })).body;
    // Employees can't see the code.
    assert.equal((await cook.member.get(B(`/locations/${loc.id}/door`))).status, 403);
    const door = (await mgr.member.get(B(`/locations/${loc.id}/door`))).body;
    assert.match(door.code, /^\d{6}$/);
    assert.ok(door.qrSvg.startsWith('<svg'));
    assert.ok(door.url.includes(`/#/clock?l=${loc.id}&c=${door.code}`));
    assert.ok(door.validUntil);
    // Daily mode for a printed sheet.
    await owner.put(B(`/locations/${loc.id}`), { doorMode: 'daily' });
    const daily = (await mgr.member.get(B(`/locations/${loc.id}/door`))).body;
    assert.equal(daily.mode, 'daily');
    assert.match(daily.day, /^\d{4}-\d{2}-\d{2}$/);
    // Resetting invalidates every code shown so far.
    await owner.post(B(`/locations/${loc.id}/door/reset`));
    const r = await cook.member.post(B('/attendance/clock-in'), { locationId: loc.id, code: daily.code, ...north(5), accuracy: 5 });
    assert.equal(r.body.error.code, 'invalid_door_code');
    // The secret never leaves the server.
    const list = (await cook.member.get(B('/locations'))).body;
    assert.ok(!JSON.stringify(list).includes('secret'));
  });

  it('can be switched off by the owner', async () => {
    const { owner, cook, B } = await restaurant(t);
    await owner.post(B('/locations'), { name: 'PizzaRita', latitude: SHOP.lat, longitude: SHOP.lng });
    await owner.put(B('/settings'), { settings: { attendance: { requireZone: false } } });
    assert.equal((await cook.member.post(B('/attendance/clock-in'))).status, 200);
  });
});

// ---------- drivers per trip, and pay frequency per person ----------

// Saturday-start weeks: a Saturday a few weeks back, so whole weeks are in the past.
function pastSaturday(weeksBack = 3) {
  const d = new Date(Date.now() - weeksBack * 7 * 864e5);
  const back = (d.getUTCDay() - 6 + 7) % 7;
  return new Date(d - back * 864e5).toISOString().slice(0, 10);
}
const plus = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
// 09:00–17:00 Baghdad (UTC+3), no break: 8 h.
const workDay = (t, owner, B, membershipId, day, hoursLong = 8) => owner.post(B('/attendance'), {
  membershipId, clockIn: `${day}T06:00:00.000Z`, clockOut: new Date(Date.parse(`${day}T06:00:00.000Z`) + hoursLong * 3600000).toISOString(), breakMinutes: 0,
});

describe('delivery trips and pay frequency (PizzaRita)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('pays drivers per trip from the trips a manager enters, daily', async () => {
    const { owner, mgr, cook, B } = await restaurant(t);
    const driver = await addMember(t, owner, (await owner.refresh()).businesses[0].id, { email: 'driver@pizzarita.test', name: 'Yousif Driver' });
    const sat = pastSaturday();
    await owner.post(B(`/members/${driver.membershipId}/pay-rates`), { payType: 'per_trip', rate: 2500, effectiveFrom: plus(sat, -30), frequency: 'daily' });
    // Only managers enter trips, and only for drivers.
    assert.equal((await driver.member.put(B('/trips'), { day: sat, entries: [{ membershipId: driver.membershipId, trips: 99 }] })).status, 403);
    const notDriver = await mgr.member.put(B('/trips'), { day: sat, entries: [{ membershipId: cook.membershipId, trips: 3 }] });
    assert.equal(notDriver.body.error.code, 'not_a_driver');
    assert.equal((await mgr.member.put(B('/trips'), { day: sat, entries: [{ membershipId: driver.membershipId, trips: 14 }] })).status, 200);
    await mgr.member.put(B('/trips'), { day: plus(sat, 1), entries: [{ membershipId: driver.membershipId, trips: 9, note: 'Rainy evening' }] });
    // Corrected later the same day: history keeps the old number.
    await mgr.member.put(B('/trips'), { day: sat, entries: [{ membershipId: driver.membershipId, trips: 15 }] });

    const listed = (await mgr.member.get(B(`/trips?from=${sat}&to=${plus(sat, 6)}`))).body;
    assert.deepEqual(listed.drivers.map((d) => d.name), ['Yousif Driver']);
    assert.deepEqual(listed.entries.map((e) => e.trips), [15, 9]);
    // The driver sees their own trips.
    assert.equal((await driver.member.get(B(`/trips?from=${sat}&to=${plus(sat, 6)}&mine=true`))).body.entries.length, 2);

    // A daily payroll for Saturday pays exactly Saturday's trips.
    const run = (await owner.post(B('/payroll/runs'), { date: sat, frequency: 'daily' })).body;
    assert.equal(run.frequency, 'daily');
    assert.equal(run.periodStart, sat);
    const p = run.people.find((x) => x.membershipId === driver.membershipId);
    assert.equal(p.tripCount, 15);
    assert.equal(p.trips, 15 * 2500);
    assert.equal(p.gross, 15 * 2500);
    // A weekly payroll doesn't include the daily-paid driver.
    const weekly = (await owner.post(B('/payroll/runs'), { date: sat, frequency: 'weekly' })).body;
    assert.ok(!weekly.people.some((x) => x.membershipId === driver.membershipId));

    // Once Saturday is paid, its trips are locked.
    await owner.post(B(`/payroll/runs/${run.id}/finalize`));
    await owner.post(B(`/payroll/runs/${run.id}/pay`), {});
    const late = await mgr.member.put(B('/trips'), { day: sat, entries: [{ membershipId: driver.membershipId, trips: 20 }] });
    assert.equal(late.body.error.code, 'period_locked');
    // Trip pay counts as labour cost.
    const pnl = (await owner.get(B(`/finance/pnl?from=${sat}&to=${sat}`))).body;
    assert.equal(pnl.laborCost, 15 * 2500);
  });

  it('pays hours and trips recorded before someone\'s first pay rate, but not salary', async () => {
    const { owner, mgr, cook, B } = await restaurant(t);
    const driver = await addMember(t, owner, (await owner.refresh()).businesses[0].id, { email: 'driver@pizzarita.test', name: 'Yousif Driver' });
    const sat = pastSaturday();
    // Added to the app on Monday, but they started on Saturday.
    await owner.post(B(`/members/${driver.membershipId}/pay-rates`), { payType: 'per_trip', rate: 2500, effectiveFrom: plus(sat, 2), frequency: 'weekly' });
    await owner.post(B(`/members/${cook.membershipId}/pay-rates`), { payType: 'hourly', rate: 5000, effectiveFrom: plus(sat, 2), frequency: 'weekly' });
    await owner.post(B(`/members/${mgr.membershipId}/pay-rates`), { payType: 'salaried', rate: 3000000, effectiveFrom: plus(sat, 2), frequency: 'weekly' });
    // Trips can be entered for Saturday even though the rate starts Monday.
    assert.equal((await mgr.member.get(B(`/trips?from=${sat}&to=${sat}`))).body.drivers.length, 1);
    assert.equal((await mgr.member.put(B('/trips'), { day: sat, entries: [{ membershipId: driver.membershipId, trips: 10 }] })).status, 200);
    await workDay(t, owner, B, cook.membershipId, sat, 4);
    const run = (await owner.post(B('/payroll/runs'), { date: sat, frequency: 'weekly' })).body;
    const of = (id) => run.people.find((x) => x.membershipId === id);
    assert.equal(of(driver.membershipId).trips, 10 * 2500);
    assert.equal(of(cook.membershipId).base, 4 * 5000);
    // The salary starts on Monday: Monday to Friday only.
    const inMonth = (d) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
    const expected = [2, 3, 4, 5, 6].reduce((a, n) => a + 3000000 / inMonth(plus(sat, n)), 0);
    assert.equal(of(mgr.membershipId).base, Math.round(expected));
  });

  it('moves someone from weekly to daily pay mid-week without paying any day twice', async () => {
    const { owner, cook, B } = await restaurant(t);
    const sat = pastSaturday();
    // Weekly at 5,000/h from long ago; daily from Tuesday on.
    await owner.post(B(`/members/${cook.membershipId}/pay-rates`), { payType: 'hourly', rate: 5000, effectiveFrom: plus(sat, -60), frequency: 'weekly' });
    await owner.post(B(`/members/${cook.membershipId}/pay-rates`), { payType: 'hourly', rate: 5000, effectiveFrom: plus(sat, 3), frequency: 'daily' });
    for (let i = 0; i < 6; i++) await workDay(t, owner, B, cook.membershipId, plus(sat, i)); // Sat–Thu, 8 h each = 48 h

    const weekly = (await owner.post(B('/payroll/runs'), { date: sat, frequency: 'weekly' })).body;
    const w = weekly.people.find((x) => x.membershipId === cook.membershipId);
    assert.equal(w.hours, 24, 'Sat, Sun, Mon on the weekly payroll');
    let dailyHours = 0;
    for (let i = 3; i < 6; i++) {
      const d = (await owner.post(B('/payroll/runs'), { date: plus(sat, i), frequency: 'daily' })).body;
      dailyHours += d.people.find((x) => x.membershipId === cook.membershipId).hours;
    }
    assert.equal(dailyHours, 24, 'Tue, Wed, Thu each on their own daily payroll');
    // Recalculating the weekly run doesn't pick up the daily days.
    const again = (await owner.post(B(`/payroll/runs/${weekly.id}/recalculate`))).body;
    assert.equal(again.people.find((x) => x.membershipId === cook.membershipId).hours, 24);
  });

  it('still pays weekly overtime when someone is paid daily', async () => {
    const { owner, cook, B } = await restaurant(t);
    const sat = pastSaturday();
    await owner.post(B(`/members/${cook.membershipId}/pay-rates`), { payType: 'hourly', rate: 4000, effectiveFrom: plus(sat, -10), frequency: 'daily' });
    // 10 h a day for five days = 50 h; the limit is 48 h a week.
    for (let i = 0; i < 5; i++) await workDay(t, owner, B, cook.membershipId, plus(sat, i), 10);
    const fifth = (await owner.post(B('/payroll/runs'), { date: plus(sat, 4), frequency: 'daily' })).body;
    const p = fifth.people.find((x) => x.membershipId === cook.membershipId);
    assert.equal(p.hours, 10);
    assert.equal(p.overtimeHours, 2, 'the last 2 h of the week are overtime');
    assert.equal(p.overtime, Math.round(2 * 4000 * 1.5));
  });

  it('never repays a day after the business default frequency changes', async () => {
    const { owner, cook, B } = await restaurant(t);
    const sat = pastSaturday();
    await owner.post(B(`/members/${cook.membershipId}/pay-rates`), { payType: 'hourly', rate: 5000, effectiveFrom: plus(sat, -10) });
    await workDay(t, owner, B, cook.membershipId, sat);
    await owner.put(B('/settings'), { settings: { payroll: { frequency: 'weekly' } } });
    const weekly = (await owner.post(B('/payroll/runs'), { date: sat })).body;
    assert.equal(weekly.frequency, 'weekly');
    assert.equal(weekly.people[0].hours, 8);
    await owner.post(B(`/payroll/runs/${weekly.id}/finalize`));
    await owner.post(B(`/payroll/runs/${weekly.id}/pay`), {});
    // Switch the default to daily: Saturday is already paid, so a daily run pays nothing for it.
    await owner.put(B('/settings'), { settings: { payroll: { frequency: 'daily' } } });
    const daily = (await owner.post(B('/payroll/runs'), { date: sat })).body;
    assert.ok(!daily.people.some((x) => x.membershipId === cook.membershipId && x.hours > 0));
    // And the paid day can't be edited.
    const edit = await owner.post(B('/attendance'), { membershipId: cook.membershipId, clockIn: `${sat}T18:00:00.000Z`, clockOut: `${sat}T19:00:00.000Z` });
    assert.equal(edit.body.error.code, 'period_locked');
  });
});

// ---------- restaurant setup and section costs ----------

describe('restaurant sections (PizzaRita)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('sets up kitchen, front of house and delivery with restaurant categories, once', async () => {
    const { owner, mgr, B } = await restaurant(t);
    assert.equal((await mgr.member.post(B('/setup/restaurant'))).status, 403);
    const r = (await owner.post(B('/setup/restaurant'))).body;
    assert.equal(r.kind, 'restaurant');
    assert.equal(r.sections.length, 3);
    // Repeating it adds nothing.
    const again = (await owner.post(B('/setup/restaurant'))).body;
    assert.deepEqual([again.sections.length, again.expenseCategories, again.revenueCategories], [0, 0, 0]);
    const keys = (await owner.get(B('/categories/revenue'))).body.map((c) => c.key);
    assert.ok(['dine_in', 'takeaway', 'delivery_sales'].every((k) => keys.includes(k)));
    assert.ok((await owner.get(B('/categories/expense'))).body.some((c) => c.key === 'cooking_gas'));
    assert.equal((await owner.get(B('/settings'))).body.kind, 'restaurant');
  });

  it('shows costs per section: tagged expenses, claims and pay of the people working there', async () => {
    const { owner, cook, mgr, B } = await restaurant(t);
    await owner.post(B('/setup/restaurant'));
    const depts = (await owner.get(B('/departments'))).body;
    // Sections are named in the business's language (Arabic here).
    const AR = { Kitchen: 'المطبخ', 'Front of house': 'الصالة', Delivery: 'التوصيل' };
    const id = (n) => depts.find((d) => d.name === n || d.name === AR[n]).id;
    const driver = await addMember(t, owner, (await owner.refresh()).businesses[0].id, { email: 'driver@pizzarita.test', name: 'Yousif Driver' });
    await owner.put(B(`/members/${driver.membershipId}`), { departmentId: id('Delivery') });
    await owner.put(B(`/members/${cook.membershipId}`), { departmentId: id('Kitchen') });
    const cats = (await owner.get(B('/categories/expense'))).body;
    const cat = (k) => cats.find((c) => c.key === k).id;
    const sat = pastSaturday();
    await owner.post(B('/business-expenses'), { amount: 300000, spentOn: sat, categoryId: cat('ingredients'), departmentId: id('Kitchen') });
    await owner.post(B('/business-expenses'), { amount: 40000, spentOn: sat, categoryId: cat('cooking_gas'), departmentId: id('Kitchen') });
    await owner.post(B('/business-expenses'), { amount: 25000, spentOn: sat, categoryId: cat('fuel'), departmentId: id('Delivery') });
    await owner.post(B('/business-expenses'), { amount: 500000, spentOn: sat, categoryId: cat('rent') });
    // The driver is paid per trip; then moves section, which mustn't rewrite history.
    await owner.post(B(`/members/${driver.membershipId}/pay-rates`), { payType: 'per_trip', rate: 2500, effectiveFrom: plus(sat, -30), frequency: 'daily' });
    await mgr.member.put(B('/trips'), { day: sat, entries: [{ membershipId: driver.membershipId, trips: 12 }] });
    const run = (await owner.post(B('/payroll/runs'), { date: sat, frequency: 'daily' })).body;
    await owner.post(B(`/payroll/runs/${run.id}/finalize`));
    await owner.put(B(`/members/${driver.membershipId}`), { departmentId: id('Kitchen') });

    const r = await owner.get(B(`/analytics/sections?from=${sat}&to=${sat}`));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = (n) => r.body.sections.find((x) => x.id === id(n));
    assert.equal(s('Kitchen').expenses, 340000);
    assert.equal(s('Kitchen').labour, 0);
    assert.equal(s('Kitchen').topCategories[0].key, 'ingredients');
    assert.equal(s('Delivery').expenses, 25000);
    assert.equal(s('Delivery').labour, 12 * 2500);
    assert.equal(s('Front of house').total, 0);
    const none = r.body.sections.find((x) => x.id === null);
    assert.equal(none.expenses, 500000);
    assert.equal(r.body.total, 340000 + 25000 + 30000 + 500000);
    // Only people who can see finance get this.
    assert.equal((await cook.member.get(B(`/analytics/sections?from=${sat}&to=${sat}`))).status, 403);
  });
});
