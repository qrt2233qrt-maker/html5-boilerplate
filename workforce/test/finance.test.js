import assert from 'node:assert/strict';
import { addMember, ownerWithBusiness, setup } from './helpers.js';

async function team(t) {
  const o = await ownerWithBusiness(t);
  const a = await addMember(t, o.owner, o.businessId, { email: 'a@example.com', name: 'Ali Hourly' });
  const s = await addMember(t, o.owner, o.businessId, { email: 's@example.com', name: 'Sara Salaried' });
  const m = await addMember(t, o.owner, o.businessId, { email: 'm@example.com', name: 'Mona Manager', role: 'manager' });
  const B = (p) => `/api/b/${o.businessId}${p}`;
  const cats = (await o.owner.get(B('/categories/expense'))).body;
  const cat = (key) => cats.find((c) => c.key === key).id;
  const rcats = (await o.owner.get(B('/categories/revenue'))).body;
  const rcat = (key) => rcats.find((c) => c.key === key).id;
  return { ...o, a, s, m, B, cat, rcat };
}

// A closed attendance record at local Baghdad time (UTC+3).
async function worked(t, membershipId, businessId, day, fromHour, toHour) {
  await t.pool.query(
    `INSERT INTO attendance (business_id, membership_id, clock_in, clock_out, source)
     VALUES ($1, $2, ($3 || ' ' || $4 || ':00')::timestamp AT TIME ZONE 'Asia/Baghdad', ($3 || ' ' || $5 || ':00')::timestamp AT TIME ZONE 'Asia/Baghdad', 'manager')`,
    [businessId, membershipId, day, `${fromHour}`.padStart(2, '0'), `${toHour}`.padStart(2, '0')]);
}

describe('payroll (phase 6)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('pays hourly staff from attendance with weekly overtime, and prorates salaries', async () => {
    const { owner, a, s, B, businessId } = await team(t);
    await owner.put(B('/settings'), { settings: { payroll: { overtimeWeeklyHours: 10, overtimeMultiplier: 1.5, weekStartsOn: 6 } } });
    await owner.post(B(`/members/${a.membershipId}/pay-rates`), { payType: 'hourly', rate: 6000, effectiveFrom: '2025-01-01' });
    await owner.post(B(`/members/${s.membershipId}/pay-rates`), { payType: 'salaried', rate: 900000, effectiveFrom: '2025-01-01' });
    await owner.put(B(`/members/${s.membershipId}`), { profile: { startDate: '2025-03-16' } });
    // Sun, Mon, Tue of one Saturday-start week: 24 hours.
    for (const d of ['2025-03-09', '2025-03-10', '2025-03-11']) await worked(t, a.membershipId, businessId, d, 9, 17);
    const run = (await owner.post(B('/payroll/runs'), { date: '2025-03-20' })).body;
    assert.equal(run.periodStart, '2025-03-01');
    assert.equal(run.periodEnd, '2025-03-31');
    const ali = run.people.find((p) => p.name === 'Ali Hourly');
    assert.equal(ali.hours, 24);
    assert.equal(ali.overtimeHours, 14);
    assert.equal(ali.base, 60000); // 10 h × 6,000
    assert.equal(ali.overtime, 126000); // 14 h × 6,000 × 1.5
    const sara = run.people.find((p) => p.name === 'Sara Salaried');
    assert.equal(sara.base, Math.round((900000 * 16) / 31)); // started on the 16th
  });

  it('adds reimbursements, bonuses and deductions, then locks once paid', async () => {
    const { owner, a, m, B, cat, businessId } = await team(t);
    await owner.post(B(`/members/${a.membershipId}/pay-rates`), { payType: 'salaried', rate: 500000, effectiveFrom: '2025-01-01' });
    const claim = (await a.member.post(B('/employee-expenses'), { amount: 15000, spentOn: '2025-03-05', categoryId: cat('fuel'), description: 'Delivery fuel', submit: true })).body;
    await m.member.post(B(`/employee-expenses/${claim.id}/decide`), { action: 'approve' });
    let run = (await owner.post(B('/payroll/runs'), { date: '2025-03-20' })).body;
    run = (await owner.post(B(`/payroll/runs/${run.id}/items`), { membershipId: a.membershipId, kind: 'bonus', amount: 50000, description: 'Eid bonus' })).body;
    run = (await owner.post(B(`/payroll/runs/${run.id}/items`), { membershipId: a.membershipId, kind: 'deduction', amount: 20000, description: 'Advance' })).body;
    const ali = run.people.find((p) => p.membershipId === a.membershipId);
    assert.deepEqual([ali.gross, ali.reimbursements, ali.deductions, ali.net], [550000, 15000, 20000, 545000]);

    // Drafts are invisible to the employee; finalized pay shows as pending.
    assert.equal((await a.member.get(B('/me/pay'))).body.current, null);
    await owner.post(B(`/payroll/runs/${run.id}/finalize`));
    const pending = (await a.member.get(B('/me/pay'))).body.current;
    assert.deepEqual([pending.status, pending.net], ['pending', 545000]);

    // A flagged statement can't be paid until the flag is cleared.
    await owner.post(B(`/payroll/runs/${run.id}/review`), { membershipId: a.membershipId, review: true, note: 'Check hours' });
    assert.equal((await a.member.get(B('/me/pay'))).body.current.status, 'review');
    assert.equal((await owner.post(B(`/payroll/runs/${run.id}/pay`))).body.error.code, 'needs_review');
    await owner.post(B(`/payroll/runs/${run.id}/review`), { membershipId: a.membershipId, review: false });
    const paid = (await owner.post(B(`/payroll/runs/${run.id}/pay`))).body;
    assert.equal(paid.status, 'paid');
    assert.equal((await a.member.get(B('/me/pay'))).body.current.status, 'paid');
    assert.equal((await a.member.get(B(`/employee-expenses/${claim.id}`))).body.status, 'reimbursed');

    // Paid payroll is locked, and so is attendance inside it.
    assert.equal((await owner.post(B(`/payroll/runs/${run.id}/items`), { membershipId: a.membershipId, kind: 'bonus', amount: 1, description: 'x' })).body.error.code, 'run_locked');
    await worked(t, a.membershipId, businessId, '2025-03-12', 9, 17);
    const { rows: [rec] } = await t.pool.query('SELECT id FROM attendance WHERE membership_id = $1', [a.membershipId]);
    assert.equal((await owner.put(B(`/attendance/${rec.id}`), { breakMinutes: 30, reason: 'x' })).body.error.code, 'period_locked');
    // Employees can't touch payroll.
    assert.equal((await a.member.get(B('/payroll/runs'))).status, 403);
  });

  it('computes biweekly and weekly periods from the business week start', async () => {
    const { periodFor } = await import('../server/services/payroll.js');
    assert.deepEqual(periodFor('2025-03-12', { frequency: 'weekly', weekStartsOn: 6 }), ['2025-03-08', '2025-03-14']);
    const [s1, e1] = periodFor('2025-03-12', { frequency: 'biweekly', weekStartsOn: 6 });
    assert.equal((Date.parse(e1) - Date.parse(s1)) / 86400000, 13);
    assert.deepEqual(periodFor(e1, { frequency: 'biweekly', weekStartsOn: 6 }), [s1, e1]);
  });
});

describe('employee expenses (phase 7)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('sends large claims to the owner after the manager approves', async () => {
    const { owner, a, m, B, cat } = await team(t);
    await owner.put(B('/settings'), { settings: { approvals: { expenseOwnerOver: 100000 } } });
    const big = (await a.member.post(B('/employee-expenses'), { amount: 200000, spentOn: '2025-03-05', categoryId: cat('equipment'), description: 'Mixer part', submit: true })).body;
    assert.equal(big.needsOwner, true);
    assert.equal((await a.member.post(B(`/employee-expenses/${big.id}/decide`), { action: 'approve' })).status, 403, 'not your own');
    const step1 = (await m.member.post(B(`/employee-expenses/${big.id}/decide`), { action: 'approve' })).body;
    assert.deepEqual([step1.status, step1.approvalStep], ['under_review', 2]);
    assert.equal((await m.member.post(B(`/employee-expenses/${big.id}/decide`), { action: 'approve' })).status, 403);
    const final = (await owner.post(B(`/employee-expenses/${big.id}/decide`), { action: 'approve' })).body;
    assert.equal(final.status, 'approved');
    assert.equal(final.approvals.filter((x) => x.decision === 'approve').length, 2);
  });

  it('requires a reason to reject, lets the employee fix and resubmit, and only allows work categories', async () => {
    const { a, m, B, cat } = await team(t);
    assert.equal((await a.member.post(B('/employee-expenses'), { amount: 1000, spentOn: '2025-03-05', categoryId: cat('rent'), description: 'x' })).body.error.code, 'invalid_category');
    const c = (await a.member.post(B('/employee-expenses'), { amount: 9000, spentOn: '2025-03-05', categoryId: cat('parking'), description: 'Parking', submit: true })).body;
    assert.equal((await m.member.post(B(`/employee-expenses/${c.id}/decide`), { action: 'reject' })).body.error.code, 'reason_required');
    await m.member.post(B(`/employee-expenses/${c.id}/decide`), { action: 'reject', note: 'No receipt' });
    assert.equal((await a.member.get(B(`/employee-expenses/${c.id}`))).body.rejectionReason, 'No receipt');
    const again = (await a.member.put(B(`/employee-expenses/${c.id}`), { amount: 8000, submit: true })).body;
    assert.equal(again.status, 'submitted');
    // Submitted claims are frozen for the employee.
    assert.equal((await a.member.put(B(`/employee-expenses/${c.id}`), { amount: 1 })).body.error.code, 'locked');
  });

  it('does not create duplicates when a request is retried', async () => {
    const { a, B, cat } = await team(t);
    const send = () => t.app.inject({
      method: 'POST', url: B('/employee-expenses'),
      headers: { cookie: a.member.cookie, 'x-csrf-token': a.member.csrf, 'idempotency-key': 'retry-key-123456' },
      payload: { amount: 5000, spentOn: '2025-03-05', categoryId: cat('meals'), description: 'Lunch with supplier', submit: true },
    });
    const first = await send();
    const second = await send();
    assert.equal(JSON.parse(first.body).id, JSON.parse(second.body).id);
    const { rows } = await t.pool.query('SELECT count(*)::int AS n FROM employee_expenses');
    assert.equal(rows[0].n, 1);
  });
});

describe('business finance (phases 8-10)', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('calculates profit and loss from real records', async () => {
    const { owner, a, m, B, cat, rcat } = await team(t);
    await owner.post(B('/revenue'), { amount: 500000, receivedOn: '2025-03-03', categoryId: rcat('sales') });
    await owner.post(B('/revenue'), { amount: 20000, receivedOn: '2025-03-04', categoryId: rcat('refunds') });
    await owner.post(B('/business-expenses'), { amount: 100000, spentOn: '2025-03-01', categoryId: cat('rent'), vendor: 'Landlord' });
    await owner.post(B('/business-expenses'), { amount: 999999, spentOn: '2025-04-01', categoryId: cat('rent') });
    await owner.post(B(`/members/${a.membershipId}/pay-rates`), { payType: 'salaried', rate: 200000, effectiveFrom: '2025-01-01' });
    const claim = (await a.member.post(B('/employee-expenses'), { amount: 30000, spentOn: '2025-03-05', categoryId: cat('fuel'), description: 'Fuel', submit: true })).body;
    await m.member.post(B(`/employee-expenses/${claim.id}/decide`), { action: 'approve' });
    const run = (await owner.post(B('/payroll/runs'), { date: '2025-03-20' })).body;
    await owner.post(B(`/payroll/runs/${run.id}/finalize`));

    const pnl = (await owner.get(B('/finance/pnl?from=2025-03-01&to=2025-03-31'))).body;
    assert.equal(pnl.revenue.total, 480000);
    assert.equal(pnl.payroll.gross, 200000);
    assert.equal(pnl.expenses.total, 100000 + 200000 + 30000);
    assert.equal(pnl.profit, 480000 - 330000);
    assert.equal(pnl.laborCost, 200000);
    assert.ok(Math.abs(pnl.margin - 150000 / 480000) < 1e-9);
    const keys = pnl.expenses.byCategory.map((c) => c.key);
    assert.deepEqual(keys, ['payroll', 'rent', 'employee_reimbursements']);
    // Finance is closed to employees and, by default, to managers.
    assert.equal((await a.member.get(B('/finance/pnl?from=2025-03-01&to=2025-03-31'))).status, 403);
    assert.equal((await m.member.get(B('/finance/pnl?from=2025-03-01&to=2025-03-31'))).status, 403);
  });

  it('keeps history when an expense changes and archives instead of deleting', async () => {
    const { owner, B, cat } = await team(t);
    const x = (await owner.post(B('/business-expenses'), { amount: 50000, spentOn: '2025-03-01', categoryId: cat('supplies') })).body;
    assert.equal((await owner.put(B(`/business-expenses/${x.id}`), { amount: 55000 })).status, 400, 'reason required');
    await owner.put(B(`/business-expenses/${x.id}`), { amount: 55000, reason: 'Typo on receipt' });
    await owner.post(B(`/business-expenses/${x.id}/archive`), { archived: true, reason: 'Duplicate' });
    const hist = (await owner.get(B(`/business-expenses/${x.id}/history`))).body;
    assert.deepEqual(hist.map((h) => h.changeType), ['created', 'updated', 'archived']);
    assert.equal(hist[1].before.amount, 50000);
    assert.equal(hist[1].after.amount, 55000);
    const list = (await owner.get(B('/business-expenses?from=2025-03-01&to=2025-03-31'))).body;
    assert.equal(list.count, 0);
    await assert.rejects(t.pool.query('DELETE FROM record_history'), /append-only/);
  });

  it('generates recurring expenses on month ends without drifting, and only once', async () => {
    const { owner, B, cat } = await team(t);
    const { generateDue, occurrence } = await import('../server/services/finance.js');
    assert.deepEqual([1, 2, 3].map((k) => occurrence('2025-01-31', 'monthly', 1, k)), ['2025-02-28', '2025-03-31', '2025-04-30']);
    const start = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
    const r = (await owner.post(B('/recurring-expenses'), { amount: 2000000, categoryId: cat('rent'), description: 'Shop rent', frequency: 'monthly', startOn: start })).body;
    assert.ok(r.nextOn > start);
    const { rows: [n] } = await t.pool.query('SELECT count(*)::int AS n FROM business_expenses WHERE recurring_id = $1', [r.id]);
    assert.equal(n.n, 3);
    assert.equal(await generateDue(t.pool), 0, 'running again adds nothing');
    const up = (await owner.get(B('/recurring-expenses/upcoming?days=95'))).body;
    assert.ok(up.items.length >= 3);
    assert.equal(up.items[0].amount, 2000000);
  });

  it('tracks budgets against actual spending', async () => {
    const { owner, B, cat } = await team(t);
    const today = new Date().toISOString().slice(0, 10);
    await owner.post(B('/budgets'), { scope: 'category', categoryId: cat('marketing'), period: 'monthly', amount: 100000 });
    await owner.post(B('/business-expenses'), { amount: 120000, spentOn: today, categoryId: cat('marketing') });
    const [b] = (await owner.get(B(`/budgets?date=${today}`))).body;
    assert.deepEqual([b.actual, b.remaining, b.over], [120000, -20000, true]);
    assert.equal((await owner.post(B('/budgets'), { scope: 'category', categoryId: cat('marketing'), period: 'monthly', amount: 1 })).status, 409);
  });
});
