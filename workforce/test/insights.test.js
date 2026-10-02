import assert from 'node:assert/strict';
import { addMember, ownerWithBusiness, setup } from './helpers.js';
import { processReportJobs } from '../server/services/reports.js';
import { scanAlerts } from '../server/services/analytics.js';

async function team(t) {
  const o = await ownerWithBusiness(t);
  const a = await addMember(t, o.owner, o.businessId, { email: 'a@example.com', name: 'Ali Employee' });
  const m = await addMember(t, o.owner, o.businessId, { email: 'm@example.com', name: 'Mona Manager', role: 'manager' });
  const B = (p) => `/api/b/${o.businessId}${p}`;
  const cats = (await o.owner.get(B('/categories/expense'))).body;
  const cat = (key) => cats.find((c) => c.key === key).id;
  const rcats = (await o.owner.get(B('/categories/revenue'))).body;
  const rcat = (key) => rcats.find((c) => c.key === key).id;
  return { ...o, a, m, B, cat, rcat };
}

// Today in Baghdad and the first day of this and last month.
function months() {
  const local = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const [y, mo] = local.split('-').map(Number);
  const first = `${local.slice(0, 7)}-01`;
  const prevFirst = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 10);
  return { today: local, first, prevFirst };
}

describe('analytics and alerts (phase 11)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('compares a period with the one before and drills into a category', async () => {
    const { owner, a, B, cat, rcat } = await team(t);
    await owner.post(B('/revenue'), { amount: 300000, receivedOn: '2025-03-10', categoryId: rcat('sales') });
    await owner.post(B('/revenue'), { amount: 200000, receivedOn: '2025-02-10', categoryId: rcat('sales') });
    await owner.post(B('/business-expenses'), { amount: 100000, spentOn: '2025-03-01', categoryId: cat('rent'), vendor: 'Landlord' });
    await owner.post(B('/business-expenses'), { amount: 50000, spentOn: '2025-03-02', categoryId: cat('supplies') });
    await owner.post(B('/business-expenses'), { amount: 80000, spentOn: '2025-02-01', categoryId: cat('rent') });
    const o = (await owner.get(B('/analytics/overview?from=2025-03-01&to=2025-03-28'))).body;
    assert.equal(o.previousFrom, '2025-02-01');
    assert.equal(o.kpis.revenue.value, 300000);
    assert.equal(o.kpis.revenue.previous, 200000);
    assert.equal(o.kpis.revenue.change, 0.5);
    assert.equal(o.kpis.profit.value, 150000);
    assert.equal(o.bucket, 'day');
    assert.equal(o.series.length, 28);
    assert.equal(o.series.reduce((s, x) => s + x.revenue, 0), 300000);
    assert.equal(o.expenseBreakdown[0].key, 'rent');

    const d = (await owner.get(B('/analytics/expenses/rent?from=2025-03-01&to=2025-03-28'))).body;
    assert.deepEqual([d.total, d.count, d.previous], [100000, 1, 80000]);
    assert.ok(Math.abs(d.share - 100000 / 150000) < 1e-9);
    assert.equal(d.transactions[0].label, 'Landlord');
    assert.ok(d.monthly.some((x) => x.month === '2025-02' && x.amount === 80000));
    // Financial analytics are owner-level by default.
    assert.equal((await a.member.get(B('/analytics/overview?from=2025-03-01&to=2025-03-28'))).status, 403);
  });

  it('counts people, hours and shifts for managers', async () => {
    const { m, B } = await team(t);
    const w = (await m.member.get(B(`/analytics/workforce?from=${months().first}&to=${months().today}`))).body;
    assert.equal(w.employees.active, 2);
    assert.equal(w.employees.new, 2);
  });

  it('raises a revenue-drop alert once, lets the owner dismiss it, and respects thresholds', async () => {
    const { owner, B, rcat, businessId } = await team(t);
    const { first, prevFirst } = months();
    await owner.post(B('/revenue'), { amount: 100000, receivedOn: prevFirst, categoryId: rcat('sales') });
    await owner.post(B('/revenue'), { amount: 10000, receivedOn: first, categoryId: rcat('sales') });
    const alerts = (await owner.get(B('/alerts'))).body;
    const drop = alerts.find((x) => x.type === 'revenue_drop');
    assert.equal(drop.data.pct, 90);
    assert.equal(await scanAlerts(t.pool) >= 1, true);
    assert.equal(await scanAlerts(t.pool), 0, 'notified only once');
    const { rows } = await t.pool.query('SELECT count(*)::int AS n FROM notifications WHERE type = \'alert.revenue_drop\' AND business_id = $1', [businessId]);
    assert.equal(rows[0].n, 1);
    await owner.post(B('/alerts/dismiss'), { key: drop.dedupeKey });
    assert.ok(!(await owner.get(B('/alerts'))).body.some((x) => x.type === 'revenue_drop'));
    await owner.put(B('/settings'), { settings: { alerts: { revenueDropPct: 95 } } });
  });
});

describe('notifications (phase 12)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('lists, counts and marks notifications read, and emails a copy when enabled', async () => {
    const { owner, a, B } = await team(t);
    await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 86400000 + 4 * 3600000).toISOString(), published: true });
    let list = (await a.member.get(B('/notifications'))).body;
    assert.equal(list.unread, 1);
    assert.equal(list.items[0].type, 'shift.assigned');
    const email = await t.lastMessage('a@example.com');
    assert.match(email.subject, /new shift|مناوبة جديدة/);
    await a.member.post(B(`/notifications/${list.items[0].id}/read`));
    list = (await a.member.get(B('/notifications'))).body;
    assert.equal(list.unread, 0);
    // Turning email off stops the copies.
    await a.member.put(B('/notification-preferences'), { email: false });
    const before = t.sent.length;
    await owner.post(B('/shifts'), { membershipId: a.membershipId, startsAt: new Date(Date.now() + 3 * 86400000).toISOString(), endsAt: new Date(Date.now() + 3 * 86400000 + 4 * 3600000).toISOString(), published: true });
    await t.app.outbox.flush();
    assert.equal(t.sent.slice(before).filter((x) => x.recipient === 'a@example.com').length, 0);
    // Someone else's notification can't be touched.
    const other = (await owner.get(B('/notifications'))).body.items[0];
    if (other) assert.equal((await a.member.post(B(`/notifications/${other.id}/read`))).status, 404);
  });
});

describe('reports and exports (phase 13)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('builds reports, exports CSV and Excel in the background, and keeps files private', async () => {
    const { owner, a, m, B, cat } = await team(t);
    await owner.post(B('/business-expenses'), { amount: 75000, spentOn: '2025-03-05', categoryId: cat('supplies'), vendor: 'Souq', description: '=HYPERLINK("http://evil")' });
    const pnl = (await owner.get(B('/reports/pnl?from=2025-03-01&to=2025-03-31'))).body;
    assert.equal(pnl.rows.find((r) => r.category === 'Total expenses').amount, 75000);
    assert.equal((await a.member.get(B('/reports/pnl?from=2025-03-01&to=2025-03-31'))).status, 403);
    assert.equal((await m.member.get(B('/reports/hours?from=2025-03-01&to=2025-03-31'))).status, 200, 'operational reports for managers');
    const available = (await m.member.get(B('/reports'))).body.map((r) => r.key);
    assert.ok(available.includes('hours') && !available.includes('pnl'));

    const job = (await owner.post(B('/reports/expenses/export'), { from: '2025-03-01', to: '2025-03-31', format: 'csv', locale: 'en' })).body;
    await processReportJobs(t.app);
    const done = (await owner.get(B(`/report-exports/${job.id}`))).body;
    assert.equal(done.status, 'done');
    const file = await t.app.inject({ method: 'GET', url: B(`/documents/${done.documentId}?download=true`), headers: { cookie: owner.cookie } });
    assert.equal(file.rawPayload[0], 0xef, 'UTF-8 BOM for Excel');
    assert.match(file.body, /Amount \(IQD\)/);
    assert.match(file.body, /750/);
    assert.match(file.body, /'=HYPERLINK/, 'formula injection neutralised');
    assert.match(file.headers['content-disposition'], /attachment/);
    const peek = await t.app.inject({ method: 'GET', url: B(`/documents/${done.documentId}`), headers: { cookie: m.member.cookie } });
    assert.equal(peek.statusCode, 403);

    const x = (await owner.post(B('/reports/pnl/export'), { from: '2025-03-01', to: '2025-03-31', format: 'xlsx', locale: 'ar' })).body;
    await processReportJobs(t.app);
    const xd = (await owner.get(B(`/report-exports/${x.id}`))).body;
    const xf = await t.app.inject({ method: 'GET', url: B(`/documents/${xd.documentId}`), headers: { cookie: owner.cookie } });
    assert.equal(xf.rawPayload.subarray(0, 2).toString(), 'PK');
    assert.ok(xf.rawPayload.includes(Buffer.from('rightToLeft="1"')));
    assert.ok(xf.rawPayload.includes(Buffer.from('الربح التشغيلي')));
  });
});

describe('search and import (phases 13-14)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('only finds what each person may see', async () => {
    const { owner, a, B, cat } = await team(t);
    await owner.post(B('/business-expenses'), { amount: 1000, spentOn: '2025-03-05', categoryId: cat('supplies'), vendor: 'Mona Stationery' });
    const ownerHits = (await owner.get(B('/search?q=Mona'))).body.groups.map((g) => g.key);
    assert.ok(ownerHits.includes('employees') && ownerHits.includes('businessExpenses'));
    const empHits = (await a.member.get(B('/search?q=Mona'))).body.groups.map((g) => g.key);
    assert.deepEqual(empHits, []);
  });

  it('imports the old expenses app once, skipping rejected items', async () => {
    const { owner, a, B } = await team(t);
    const data = {
      expenses: [
        { uid: 'u1', id: 'e1', amount: 25000, categoryId: 'generator', date: '2025-03-02', vendor: 'Generator owner', method: 'cash', note: 'March amps' },
        { uid: 'u1', id: 'e2', amount: 9000, categoryId: 'fuel', date: '2025-03-03', method: 'card' },
        { uid: 'u2', id: 'e3', amount: 5000, categoryId: 'meals', date: '2025-03-04' },
      ],
      approvals: { u2__e3: { status: 'rejected' } },
      payrollRuns: { '2025-02': { lines: { emp1: { amount: 750000, date: '2025-02-28', method: 'bank' } } } },
      payrollEmployees: { emp1: { name: 'Hassan' } },
      people: { u1: 'Ali' },
    };
    const r1 = (await owner.post(B('/import/expenses-app'), data)).body;
    assert.deepEqual([r1.imported, r1.skippedRejected, r1.salaries], [2, 1, 1]);
    const r2 = (await owner.post(B('/import/expenses-app'), data)).body;
    assert.deepEqual([r2.imported, r2.alreadyImported, r2.salaries], [0, 2, 0]);
    const pnl = (await owner.get(B('/finance/pnl?from=2025-02-01&to=2025-03-31'))).body;
    assert.equal(pnl.expenses.total, 25000 + 9000 + 750000);
    assert.equal(pnl.laborCost, 750000);
    assert.ok(pnl.expenses.byCategory.some((c) => c.key === 'electricity'));
    assert.equal((await a.member.post(B('/import/expenses-app'), data)).status, 403);
  });

  it('imports the app\'s own CSV export, matching categories and skipping rejected rows', async () => {
    const { owner, B } = await team(t);
    // Exactly as the app writes it: BOM, every field quoted, CRLF, a comma and a quote inside fields.
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [
      ['Date', 'Vendor', 'Category', 'Amount', 'Currency', 'Payment method', 'Person', 'Status', 'Note', 'Receipt'],
      ['2025-04-01', 'Abu Ali, generator', 'Generator & electricity / مولّدة وكهرباء', 30000, 'IQD', 'Cash', 'Ali', 'Approved', 'April "amps"', 'no'],
      ['2025-04-02', 'Station', 'Fuel / وقود', 12000, 'IQD', 'Card', 'Ali', 'Approved', '', 'yes'],
      ['2025-04-02', 'Station', 'Fuel / وقود', 12000, 'IQD', 'Card', 'Ali', 'Approved', '', 'yes'],
      ['2025-04-03', 'Cafe', 'Meals & hospitality / وجبات وضيافة', 8000, 'IQD', 'Cash', 'Sara', 'Rejected', '', 'no'],
      ['2025-04-04', 'Print shop', 'Flyers / منشورات', 15000, 'IQD', 'Cash', 'Sara', 'Pending', '', 'no'],
    ];
    const csv = '\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n');
    const r1 = (await owner.post(B('/import/expenses-app'), { csv })).body;
    // The two identical fuel rows are two real purchases and both count.
    assert.deepEqual([r1.imported, r1.skippedRejected], [4, 1]);
    assert.deepEqual(r1.unknownCategories, ['flyers']);
    const r2 = (await owner.post(B('/import/expenses-app'), { csv })).body;
    assert.deepEqual([r2.imported, r2.alreadyImported], [0, 4]);
    const list = (await owner.get(B('/business-expenses?from=2025-04-01&to=2025-04-30'))).body.items;
    const gen = list.find((x) => x.vendor === 'Abu Ali, generator');
    assert.equal(gen.amount, 30000);
    assert.equal(gen.categoryKey, 'electricity');
    assert.ok(list.some((x) => x.vendor === 'Print shop' && x.categoryKey === 'other'));
    assert.equal((await owner.post(B('/import/expenses-app'), { csv: 'just,some\ntext,here' })).body.error.code, 'import_bad_file');
  });
});
