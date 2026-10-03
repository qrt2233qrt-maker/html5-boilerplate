import * as exp from '../services/expenses.js';
import * as fin from '../services/finance.js';
import * as pay from '../services/payroll.js';
import { requirePermission } from '../auth/session.js';
import { forbidden } from '../lib/errors.js';
import { idempotent } from '../lib/context.js';
import { arr, bool, date, idParams, int, money, obj, oneOf, optStr, optUuid, params, range, signedMoney, str, uuid } from '../lib/schema.js';

const ok = { ok: true };
const p = (k) => requirePermission(k);
const anyOf = (...perms) => async (req) => {
  if (!perms.some((k) => req.member.permissions.has(k))) throw forbidden();
};
const listQuery = obj({ ...range, categoryId: uuid, departmentId: uuid, q: str(100, 0), includeArchived: bool, limit: int(1, 500), offset: int(0, 1e6) }, ['from', 'to']);

export default async function financeRoutes(app) {
  // ----- employee work expenses -----
  const eStatus = oneOf('draft', 'submitted', 'under_review', 'approved', 'rejected', 'reimbursed');
  app.get('/employee-expenses', { schema: { params: params(), querystring: obj({ mine: bool, status: eStatus, from: date, to: date, membershipId: uuid }) } },
    async (req) => exp.listEmployeeExpenses(app, req, req.query));
  const eBody = { amount: money, spentOn: date, categoryId: uuid, description: str(300), businessPurpose: optStr(300), location: optStr(200), receiptDocumentId: optUuid, submit: bool };
  app.post('/employee-expenses', { schema: { params: params(), body: obj(eBody, ['amount', 'spentOn', 'categoryId', 'description']) } },
    async (req, reply) => reply.code(201).send(await idempotent(req, () => exp.createEmployeeExpense(app, req, req.body))));
  app.get('/employee-expenses/:id', { schema: { params: idParams } }, async (req) => exp.getEmployeeExpense(app, req, req.params.id));
  app.put('/employee-expenses/:id', { schema: { params: idParams, body: obj(eBody) } }, async (req) => exp.updateEmployeeExpense(app, req, req.params.id, req.body));
  app.delete('/employee-expenses/:id', { schema: { params: idParams } }, async (req) => { await exp.deleteDraft(app, req, req.params.id); return ok; });
  app.post('/employee-expenses/:id/decide', { schema: { params: idParams, body: obj({ action: oneOf('review', 'approve', 'reject'), note: optStr(500) }, ['action']) } },
    async (req) => exp.decideEmployeeExpense(app, req, req.params.id, req.body));
  app.post('/employee-expenses/:id/reimburse', { preHandler: p('payroll.manage'), schema: { params: idParams } }, async (req) => exp.markReimbursed(app, req, req.params.id));

  // ----- business expenses -----
  app.get('/business-expenses', { preHandler: p('business_expenses.view'), schema: { params: params(), querystring: listQuery } },
    async (req) => fin.listBusinessExpenses(app, req, req.query));
  const bBody = { amount: money, spentOn: date, categoryId: uuid, vendor: optStr(120), description: optStr(300), paymentMethod: optStr(40), departmentId: optUuid, documentId: optUuid, notes: optStr(1000) };
  app.post('/business-expenses', { preHandler: p('business_expenses.manage'), schema: { params: params(), body: obj(bBody, ['amount', 'spentOn', 'categoryId']) } },
    async (req, reply) => reply.code(201).send(await idempotent(req, () => fin.createBusinessExpense(app, req, req.body))));
  app.put('/business-expenses/:id', { preHandler: p('business_expenses.manage'), schema: { params: idParams, body: obj({ ...bBody, reason: str(300) }, ['reason']) } },
    async (req) => fin.updateBusinessExpense(app, req, req.params.id, req.body));
  app.post('/business-expenses/:id/archive', { preHandler: p('business_expenses.manage'), schema: { params: idParams, body: obj({ archived: bool, reason: str(300) }, ['archived', 'reason']) } },
    async (req) => { await fin.archiveBusinessExpense(app, req, req.params.id, req.body); return ok; });
  app.get('/business-expenses/:id/history', { preHandler: p('business_expenses.view'), schema: { params: idParams } },
    async (req) => fin.recordHistory(app, req, 'business_expense', req.params.id));

  // ----- recurring -----
  app.get('/recurring-expenses', { preHandler: p('business_expenses.view') }, async (req) => fin.listRecurring(app, req));
  app.get('/recurring-expenses/upcoming', { preHandler: p('business_expenses.view'), schema: { params: params(), querystring: obj({ days: int(1, 400) }) } },
    async (req) => fin.upcomingRecurring(app, req, req.query.days));
  const rBody = { amount: money, categoryId: uuid, vendor: optStr(120), description: str(300), paymentMethod: optStr(40), departmentId: optUuid,
    frequency: oneOf('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'), intervalCount: int(1, 365), startOn: date, endOn: { type: ['string', 'null'], format: 'date' }, active: bool, reason: optStr(300) };
  app.post('/recurring-expenses', { preHandler: p('business_expenses.manage'), schema: { params: params(), body: obj(rBody, ['amount', 'categoryId', 'description', 'frequency', 'startOn']) } },
    async (req, reply) => reply.code(201).send(await fin.saveRecurring(app, req, null, req.body)));
  app.put('/recurring-expenses/:id', { preHandler: p('business_expenses.manage'), schema: { params: idParams, body: obj(rBody) } },
    async (req) => fin.saveRecurring(app, req, req.params.id, req.body));

  // ----- revenue -----
  app.get('/revenue', { preHandler: p('revenue.view'), schema: { params: params(), querystring: listQuery } }, async (req) => fin.listRevenue(app, req, req.query));
  const vBody = { amount: signedMoney, receivedOn: date, categoryId: uuid, description: optStr(300), paymentMethod: optStr(40), source: optStr(120), notes: optStr(1000) };
  app.post('/revenue', { preHandler: p('revenue.manage'), schema: { params: params(), body: obj(vBody, ['amount', 'receivedOn', 'categoryId']) } },
    async (req, reply) => reply.code(201).send(await idempotent(req, () => fin.createRevenue(app, req, req.body))));
  app.put('/revenue/:id', { preHandler: p('revenue.manage'), schema: { params: idParams, body: obj({ ...vBody, reason: str(300) }, ['reason']) } },
    async (req) => fin.updateRevenue(app, req, req.params.id, req.body));
  app.post('/revenue/:id/archive', { preHandler: p('revenue.manage'), schema: { params: idParams, body: obj({ archived: bool, reason: str(300) }, ['archived', 'reason']) } },
    async (req) => { await fin.archiveRevenue(app, req, req.params.id, req.body); return ok; });
  app.get('/revenue/:id/history', { preHandler: p('revenue.view'), schema: { params: idParams } }, async (req) => fin.recordHistory(app, req, 'revenue', req.params.id));

  // ----- profit & loss, budgets -----
  app.get('/finance/pnl', { preHandler: p('finance.view'), schema: { params: params(), querystring: obj(range, ['from', 'to']) } }, async (req) => {
    const { assertRange } = await import('../lib/context.js');
    assertRange(req.query.from, req.query.to);
    return fin.profitAndLoss(app.db, req.member.businessId, req.query.from, req.query.to);
  });
  app.get('/budgets', { preHandler: anyOf('finance.view', 'budgets.manage'), schema: { params: params(), querystring: obj({ date }) } },
    async (req) => fin.listBudgets(app, req, req.query.date));
  app.post('/budgets', { preHandler: p('budgets.manage'), schema: { params: params(), body: obj({ scope: oneOf('category', 'payroll', 'total'), categoryId: uuid, period: oneOf('monthly', 'quarterly', 'yearly'), amount: money }, ['scope', 'amount']) } },
    async (req, reply) => reply.code(201).send(await fin.saveBudget(app, req, null, req.body)));
  app.put('/budgets/:id', { preHandler: p('budgets.manage'), schema: { params: idParams, body: obj({ amount: money, active: bool }) } },
    async (req) => fin.saveBudget(app, req, req.params.id, req.body));

  // ----- payroll -----
  app.get('/payroll/runs', { preHandler: p('payroll.view') }, async (req) => pay.listRuns(app, req));
  app.post('/payroll/runs', { preHandler: p('payroll.manage'), schema: { params: params(), body: obj({ date, frequency: oneOf('daily', 'weekly', 'biweekly', 'monthly') }) } }, async (req) => pay.createRun(app, req, req.body || {}));
  app.get('/payroll/runs/:id', { preHandler: p('payroll.view'), schema: { params: idParams } }, async (req) => pay.getRun(app, req, req.params.id));
  app.post('/payroll/runs/:id/recalculate', { preHandler: p('payroll.manage'), schema: { params: idParams } }, async (req) => pay.recalculate(app, req, req.params.id));
  app.post('/payroll/runs/:id/items', {
    preHandler: p('payroll.manage'),
    schema: { params: idParams, body: obj({ membershipId: uuid, kind: oneOf('bonus', 'deduction', 'adjustment'), amount: signedMoney, description: str(200) }, ['membershipId', 'kind', 'amount', 'description']) },
  }, async (req) => pay.addItem(app, req, req.params.id, req.body));
  app.delete('/payroll/runs/:id/items/:itemId', { preHandler: p('payroll.manage'), schema: { params: params({ id: uuid, itemId: uuid }) } },
    async (req) => pay.removeItem(app, req, req.params.id, req.params.itemId));
  app.post('/payroll/runs/:id/finalize', { preHandler: p('payroll.manage'), schema: { params: idParams } }, async (req) => pay.finalize(app, req, req.params.id));
  app.post('/payroll/runs/:id/reopen', { preHandler: p('payroll.manage'), schema: { params: idParams } }, async (req) => pay.reopen(app, req, req.params.id));
  app.post('/payroll/runs/:id/review', { preHandler: p('payroll.manage'), schema: { params: idParams, body: obj({ membershipId: uuid, review: bool, note: optStr(300) }, ['membershipId', 'review']) } },
    async (req) => pay.setReview(app, req, req.params.id, req.body.membershipId, req.body));
  app.post('/payroll/runs/:id/pay', { preHandler: p('payroll.manage'), schema: { params: idParams, body: obj({ membershipIds: arr(uuid, 1000) }) } },
    async (req) => pay.markPaid(app, req, req.params.id, req.body || {}));
  app.get('/me/pay', async (req) => pay.myPay(app, req));
  app.get('/members/:membershipId/pay', { preHandler: p('payroll.view'), schema: { params: params({ membershipId: uuid }) } }, async (req) => pay.myPay(app, req, req.params.membershipId));
}
