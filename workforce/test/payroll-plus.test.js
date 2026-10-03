import assert from 'node:assert/strict';
import { addMember, ownerWithBusiness, setup } from './helpers.js';

// A whole past month, so the run covers only finished days.
const month = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 2); return d.toISOString().slice(0, 7); })();
const first = `${month}-01`;
const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

describe('payroll: allowances, advances, payslips and corrections', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  async function shop() {
    const { owner, businessId } = await ownerWithBusiness(t, { businessName: 'PizzaRita' });
    const B = (p) => `/api/b/${businessId}${p}`;
    const cook = await addMember(t, owner, businessId, { email: 'cook@pizzarita.test', name: 'Hassan' });
    const mgr = await addMember(t, owner, businessId, { email: 'mgr@pizzarita.test', name: 'Omar', role: 'manager' });
    await owner.post(B(`/members/${cook.membershipId}/pay-rates`), { payType: 'salaried', rate: 900000, effectiveFrom: '2024-01-01', frequency: 'monthly' });
    return { owner, B, cook, mgr };
  }

  it('adds monthly allowances and deductions, and takes advances back in instalments', async () => {
    const { owner, B, cook } = await shop();
    const add = (body) => owner.post(B(`/members/${cook.membershipId}/pay-components`), body);
    assert.equal((await add({ kind: 'allowance', name: 'Transport', monthlyAmount: 60000, startsOn: '2024-01-01' })).status, 201);
    await add({ kind: 'deduction', name: 'Staff meals', monthlyAmount: 30000, startsOn: '2024-01-01' });
    const adv = await owner.post(B(`/members/${cook.membershipId}/advances`), { amount: 250000, instalment: 100000, givenOn: '2024-06-01', note: 'Rent help' });
    assert.equal(adv.status, 201, JSON.stringify(adv.body));
    assert.equal((await owner.post(B(`/members/${cook.membershipId}/advances`), { amount: 1000, instalment: 5000, givenOn: '2024-06-01' })).body.error.code, 'invalid_instalment');

    const run = (await owner.post(B('/payroll/runs'), { date: first, frequency: 'monthly' })).body;
    const p = run.people.find((x) => x.membershipId === cook.membershipId);
    assert.equal(p.base, 900000);
    assert.equal(p.allowances, 60000);
    assert.equal(p.deductions, 30000);
    assert.equal(p.advances, 100000);
    assert.equal(p.gross, 960000);
    assert.equal(p.net, 960000 - 30000 - 100000);
    await owner.post(B(`/payroll/runs/${run.id}/finalize`));
    const advances = (await owner.get(B(`/payroll/advances?membershipId=${cook.membershipId}`))).body;
    assert.equal(advances[0].repaid, 100000);
    assert.equal(advances[0].left, 150000);

    // The employee sees a detailed payslip once it's finalized.
    const slip = (await cook.member.get(B(`/payroll/runs/${run.id}/payslips/${cook.membershipId}`))).body;
    assert.equal(slip.summary.net, 830000);
    assert.equal(slip.days.length, days);
    assert.deepEqual(slip.lines.map((l) => l.kind), ['base', 'allowance', 'deduction', 'advance']);
    assert.equal(slip.advanceLeft, 150000);
    assert.equal(slip.yearToDate.net, 830000);
  });

  it('lets only the owner reopen and correct a paid payroll, with a reason, keeping the history', async () => {
    const { owner, B, cook } = await shop();
    const run = (await owner.post(B('/payroll/runs'), { date: first, frequency: 'monthly' })).body;
    await owner.post(B(`/payroll/runs/${run.id}/finalize`));
    await owner.post(B(`/payroll/runs/${run.id}/pay`), {});
    // Locked for everyone else, and editing needs it reopened.
    assert.equal((await owner.post(B(`/payroll/runs/${run.id}/items`), { membershipId: cook.membershipId, kind: 'bonus', amount: 50000, description: 'Busy month' })).body.error.code, 'run_locked');
    assert.equal((await owner.post(B(`/payroll/runs/${run.id}/reopen`), {})).body.error.code, 'reason_required');
    const r = await owner.post(B(`/payroll/runs/${run.id}/reopen`), { reason: 'Forgot the busy-month bonus' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'draft');
    await owner.post(B(`/payroll/runs/${run.id}/items`), { membershipId: cook.membershipId, kind: 'bonus', amount: 50000, description: 'Busy month' });
    await owner.post(B(`/payroll/runs/${run.id}/finalize`));
    const paid = (await owner.post(B(`/payroll/runs/${run.id}/pay`), {})).body;
    assert.equal(paid.status, 'paid');
    assert.equal(paid.corrections.length, 1);
    assert.equal(paid.corrections[0].reason, 'Forgot the busy-month bonus');
    assert.equal(paid.corrections[0].netBefore, 900000);
    assert.equal(paid.corrections[0].netAfter, 950000);
    const notes = (await cook.member.get(B('/notifications?limit=20'))).body.items.map((n) => n.type);
    assert.ok(notes.includes('salary.correcting'));
    const { rows } = await t.pool.query('SELECT count(*)::int AS n FROM audit_logs WHERE action = \'payroll.reopened_after_payment\'');
    assert.equal(rows[0].n, 1);
  });

  it('keeps reopening a paid payroll to the owner', async () => {
    const { owner, B, mgr, cook } = await shop();
    // Give the manager full payroll rights: still not enough once paid.
    const perms = await owner.put(B(`/members/${mgr.membershipId}/permissions`), { 'payroll.view': true, 'payroll.manage': true });
    assert.ok([200, 204].includes(perms.status), JSON.stringify(perms.body));
    await mgr.member.refresh();
    const run = (await owner.post(B('/payroll/runs'), { date: first, frequency: 'monthly' })).body;
    await owner.post(B(`/payroll/runs/${run.id}/finalize`));
    await owner.post(B(`/payroll/runs/${run.id}/pay`), { membershipIds: [cook.membershipId] });
    const r = await mgr.member.post(B(`/payroll/runs/${run.id}/reopen`), { reason: 'try' });
    assert.equal(r.status, 403, JSON.stringify(r.body));
  });

  it('never takes more advance back than the payroll leaves to pay', async () => {
    const { owner, B, cook } = await shop();
    await owner.post(B(`/members/${cook.membershipId}/advances`), { amount: 2000000, instalment: 1500000, givenOn: '2024-06-01' });
    const run = (await owner.post(B('/payroll/runs'), { date: first, frequency: 'monthly' })).body;
    const p = run.people.find((x) => x.membershipId === cook.membershipId);
    assert.equal(p.advances, 900000);
    assert.equal(p.net, 0);
  });
});
