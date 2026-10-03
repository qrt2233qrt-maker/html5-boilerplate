import assert from 'node:assert/strict';
import { ownerWithBusiness, setup } from './helpers.js';

describe('expenses: quantities, bills to pay and suppliers', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('works out the amount from quantity × unit price, tracks unpaid bills and supplier prices', async () => {
    const { owner, businessId } = await ownerWithBusiness(t, { businessName: 'PizzaRita' });
    const B = (p) => `/api/b/${businessId}${p}`;
    const cats = (await owner.get(B('/categories/expense'))).body;
    const cat = cats.find((c) => c.key === 'supplies').id;
    const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    // 20 kg of mozzarella at 9,500 a kg, on credit for two weeks.
    const a = await owner.post(B('/business-expenses'), { spentOn: d(-20), categoryId: cat, vendor: 'Al-Rafidain Dairy', description: 'Mozzarella',
      quantity: 20, unit: 'kg', unitPrice: 9500, paid: false, dueOn: d(-6) });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.amount, 190000);
    assert.equal(a.body.paid, false);
    // Same cheese later, dearer, paid on the spot.
    const b = await owner.post(B('/business-expenses'), { spentOn: d(-2), categoryId: cat, vendor: 'al-rafidain dairy ', description: 'Mozzarella', quantity: 10, unit: 'kg', unitPrice: 10450, paymentMethod: 'cash' });
    assert.equal(b.body.amount, 104500);
    assert.equal(b.body.paid, true);
    await owner.post(B('/business-expenses'), { spentOn: d(-1), categoryId: cat, vendor: 'Baghdad Gas', amount: 90000, paid: false, dueOn: d(5) });
    assert.equal((await owner.post(B('/business-expenses'), { spentOn: d(-1), categoryId: cat })).body.error.code, 'amount_required');

    const bills = (await owner.get(B('/bills'))).body;
    assert.equal(bills.items.length, 2);
    assert.equal(bills.total, 280000);
    assert.equal(bills.overdueCount, 1);
    assert.ok(bills.items[0].overdue && bills.items[1].dueSoon);

    const supRes = await owner.get(B(`/suppliers?from=${d(-30)}&to=${d(0)}`));
    const sup = supRes.body;
    assert.equal(supRes.status, 200, JSON.stringify(supRes.body));
    const dairy = sup.suppliers.find((s) => /rafidain/i.test(s.name));
    assert.equal(dairy.total, 294500);
    assert.equal(dairy.count, 2);
    assert.equal(dairy.unpaid, 190000);
    const cheese = sup.prices.find((p) => p.item === 'Mozzarella');
    assert.equal(cheese.latest, 10450);
    assert.equal(cheese.previous, 9500);
    assert.ok(Math.abs(cheese.change - 0.1) < 1e-9);

    // Paying the overdue bill.
    const paid = await owner.post(B(`/business-expenses/${a.body.id}/pay`), { paidOn: d(0), paymentMethod: 'bank' });
    assert.equal(paid.body.paid, true);
    assert.equal((await owner.post(B(`/business-expenses/${a.body.id}/pay`), { paidOn: d(0) })).body.error.code, 'already_paid');
    assert.equal((await owner.get(B('/bills'))).body.overdueCount, 0);
  });
});
