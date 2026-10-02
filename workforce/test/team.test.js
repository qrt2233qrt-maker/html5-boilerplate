import assert from 'node:assert/strict';
import { PASSWORD, addMember, client, ownerWithBusiness, setup, tokenIn } from './helpers.js';

describe('team, roles and permissions', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('invites an employee who sets their own password through a one-time link', async () => {
    const { owner, businessId } = await ownerWithBusiness(t);
    const inv = await owner.post(`/api/b/${businessId}/invitations`, {
      name: 'Sara', email: 'sara@example.com', role: 'employee',
      profile: { employeeNumber: 'E-104', jobTitle: 'Cashier', payType: 'hourly', payRate: 5000 },
    });
    assert.equal(inv.status, 201);
    const token = tokenIn(await t.lastMessage('sara@example.com'));
    const anon = client(t.app);
    const preview = await anon.get(`/api/invitations/${token}`);
    assert.equal(preview.body.businessName, 'Al-Noor Bakery');
    assert.equal(preview.body.email, 'sa••@example.com');

    assert.equal((await anon.post('/api/invitations/accept', { token, name: 'Sara', password: PASSWORD })).status, 200);
    const me = await anon.refresh();
    assert.equal(me.user.emailVerified, true, 'opening the emailed link verifies the email');
    assert.equal(me.businesses[0].role, 'employee');
    // The link can't be used twice.
    assert.equal((await client(t.app).post('/api/invitations/accept', { token, name: 'X', password: PASSWORD })).status, 409);
  });

  it('refuses expired and revoked invitations', async () => {
    const { owner, businessId } = await ownerWithBusiness(t);
    const inv = await owner.post(`/api/b/${businessId}/invitations`, { name: 'A', email: 'a@example.com', role: 'employee' });
    const token = tokenIn(await t.lastMessage('a@example.com'));
    await owner.post(`/api/b/${businessId}/invitations/${inv.body.id}/revoke`);
    assert.equal((await client(t.app).post('/api/invitations/accept', { token, name: 'A', password: PASSWORD })).body.error.code, 'invitation_revoked');

    await owner.post(`/api/b/${businessId}/invitations`, { name: 'B', email: 'b@example.com', role: 'employee' });
    const token2 = tokenIn(await t.lastMessage('b@example.com'));
    await t.pool.query('UPDATE invitations SET expires_at = now() - interval \'1 minute\' WHERE email = \'b@example.com\'');
    assert.equal((await client(t.app).post('/api/invitations/accept', { token: token2, name: 'B', password: PASSWORD })).body.error.code, 'invitation_expired');
  });

  it('resending replaces the old link', async () => {
    const { owner, businessId } = await ownerWithBusiness(t);
    const inv = await owner.post(`/api/b/${businessId}/invitations`, { name: 'C', email: 'c@example.com', role: 'employee' });
    const oldToken = tokenIn(await t.lastMessage('c@example.com'));
    await owner.post(`/api/b/${businessId}/invitations/${inv.body.id}/resend`);
    const newToken = tokenIn(await t.lastMessage('c@example.com'));
    assert.notEqual(oldToken, newToken);
    assert.equal((await client(t.app).get(`/api/invitations/${oldToken}`)).status, 404);
    assert.equal((await client(t.app).get(`/api/invitations/${newToken}`)).body.status, 'pending');
  });

  it('lets the owner make an employee a manager and remove it, with audit and notification', async () => {
    const { owner, businessId } = await ownerWithBusiness(t);
    const { member, membershipId } = await addMember(t, owner, businessId, { email: 'sara@example.com', name: 'Sara' });
    const promote = await owner.post(`/api/b/${businessId}/members/${membershipId}/role`, { role: 'manager' });
    assert.equal(promote.body.role, 'manager');
    let me = await member.refresh();
    assert.equal(me.businesses[0].role, 'manager');
    assert.ok(me.businesses[0].permissions.includes('schedules.manage'));

    const demote = await owner.post(`/api/b/${businessId}/members/${membershipId}/role`, { role: 'employee' });
    assert.equal(demote.body.role, 'employee');
    me = await member.refresh();
    assert.equal(me.businesses[0].status, 'active', 'removing the manager role keeps the employee');
    assert.ok(!me.businesses[0].permissions.includes('schedules.manage'));

    const log = await owner.get(`/api/b/${businessId}/audit-logs?targetType=membership`);
    const actions = log.body.items.map((i) => i.action);
    assert.ok(actions.includes('member.promoted_manager'));
    assert.ok(actions.includes('member.manager_removed'));
    const promoted = log.body.items.find((i) => i.action === 'member.promoted_manager');
    assert.deepEqual(promoted.before, { role: 'employee' });
    assert.deepEqual(promoted.after, { role: 'manager' });
    const { rows } = await t.pool.query('SELECT type FROM notifications WHERE type = \'role.changed\'');
    assert.equal(rows.length, 2);
  });

  it('stops an employee from calling owner APIs directly', async () => {
    const { owner, businessId } = await ownerWithBusiness(t);
    const { member, membershipId } = await addMember(t, owner, businessId, { email: 'e@example.com' });
    const forbidden = [
      member.get(`/api/b/${businessId}/members`),
      member.get(`/api/b/${businessId}/audit-logs`),
      member.get(`/api/b/${businessId}/permissions`),
      member.post(`/api/b/${businessId}/invitations`, { name: 'X', email: 'x@example.com', role: 'manager' }),
      member.post(`/api/b/${businessId}/members/${membershipId}/role`, { role: 'manager' }),
      member.put(`/api/b/${businessId}/permissions/employee`, { 'members.view': true }),
    ];
    for (const res of await Promise.all(forbidden)) assert.equal(res.status, 403);
  });

  it('never lets a manager gain owner powers', async () => {
    const { owner, businessId } = await ownerWithBusiness(t);
    const { member: manager, membershipId } = await addMember(t, owner, businessId, { email: 'm@example.com', role: 'manager' });
    // The owner can't grant owner-only permissions, even deliberately.
    const grant = await owner.put(`/api/b/${businessId}/members/${membershipId}/permissions`, { 'roles.assign': true });
    assert.equal(grant.status, 403);
    const grantRole = await owner.put(`/api/b/${businessId}/permissions/manager`, { 'permissions.manage': true });
    assert.equal(grantRole.status, 403);

    // Even with invite rights, a manager can't invite another manager.
    await owner.put(`/api/b/${businessId}/members/${membershipId}/permissions`, { 'members.invite': true, 'members.suspend': true });
    const inv = await manager.post(`/api/b/${businessId}/invitations`, { name: 'X', email: 'x@example.com', role: 'manager' });
    assert.equal(inv.status, 403);
    assert.equal((await manager.post(`/api/b/${businessId}/invitations`, { name: 'Y', email: 'y@example.com', role: 'employee' })).status, 201);
    // Nor promote themselves, nor change the owner.
    const me = await manager.refresh();
    assert.equal((await manager.post(`/api/b/${businessId}/members/${me.businesses[0].membershipId}/role`, { role: 'employee' })).status, 403);
    const ownerMembership = (await manager.get(`/api/b/${businessId}/members?role=owner`)).body.items[0].membershipId;
    assert.equal((await manager.post(`/api/b/${businessId}/members/${ownerMembership}/suspend`)).status, 403);
  });

  it('lets the owner turn manager permissions on or off', async () => {
    const { owner, businessId } = await ownerWithBusiness(t);
    const { member: manager } = await addMember(t, owner, businessId, { email: 'm@example.com', role: 'manager' });
    assert.equal((await manager.get(`/api/b/${businessId}/audit-logs`)).status, 403);
    await owner.put(`/api/b/${businessId}/permissions/manager`, { 'audit.view': true });
    assert.equal((await manager.get(`/api/b/${businessId}/audit-logs`)).status, 200);
    await owner.put(`/api/b/${businessId}/permissions/manager`, { 'members.view': false });
    assert.equal((await manager.get(`/api/b/${businessId}/members`)).status, 403);
    // null puts it back to the default.
    await owner.put(`/api/b/${businessId}/permissions/manager`, { 'members.view': null });
    assert.equal((await manager.get(`/api/b/${businessId}/members`)).status, 200);
  });

  it('hides pay details from people without access to sensitive data', async () => {
    const { owner, businessId } = await ownerWithBusiness(t);
    await addMember(t, owner, businessId, { email: 'e@example.com', name: 'Emp', profile: { jobTitle: 'Baker', payType: 'hourly', payRate: 6000 } });
    const { member: manager } = await addMember(t, owner, businessId, { email: 'm@example.com', name: 'Mgr', role: 'manager' });
    const asOwner = (await owner.get(`/api/b/${businessId}/members?q=e@example.com`)).body.items[0];
    const asManager = (await manager.get(`/api/b/${businessId}/members?q=e@example.com`)).body.items[0];
    assert.deepEqual({ type: asOwner.pay.payType, rate: asOwner.pay.rate }, { type: 'hourly', rate: 6000 });
    assert.equal(asManager.profile.jobTitle, 'Baker');
    assert.equal(asManager.pay, undefined);
  });

  it('suspension blocks access immediately, and reactivation restores it', async () => {
    const { owner, businessId } = await ownerWithBusiness(t);
    const { member, membershipId } = await addMember(t, owner, businessId, { email: 'e@example.com', role: 'manager' });
    assert.equal((await member.get(`/api/b/${businessId}/members`)).status, 200);
    await owner.post(`/api/b/${businessId}/members/${membershipId}/suspend`);
    assert.equal((await member.get(`/api/b/${businessId}/members`)).status, 403);
    // With no active business left, signing in is refused too.
    const login = await client(t.app).post('/api/auth/login', { identifier: 'e@example.com', password: PASSWORD });
    assert.equal(login.body.error.code, 'access_suspended');
    await owner.post(`/api/b/${businessId}/members/${membershipId}/reactivate`);
    assert.equal((await member.get(`/api/b/${businessId}/members`)).status, 200);
  });

  it('keeps businesses completely separate', async () => {
    const a = await ownerWithBusiness(t, { email: 'a@example.com', businessName: 'A' });
    const b = await ownerWithBusiness(t, { email: 'b@example.com', businessName: 'B' });
    const { membershipId } = await addMember(t, a.owner, a.businessId, { email: 'emp@example.com' });
    // Owner B can't reach business A, or act on A's people through B's URL.
    assert.equal((await b.owner.get(`/api/b/${a.businessId}/members`)).status, 404);
    assert.equal((await b.owner.post(`/api/b/${b.businessId}/members/${membershipId}/role`, { role: 'manager' })).status, 404);
    assert.equal((await b.owner.get(`/api/b/${b.businessId}/members`)).body.items.length, 1);
    const logs = (await b.owner.get(`/api/b/${b.businessId}/audit-logs`)).body.items;
    assert.ok(logs.every((l) => l.action !== 'invitation.created'));
  });

  it('paginates the team list', async () => {
    const { owner, businessId } = await ownerWithBusiness(t);
    for (let i = 0; i < 5; i++) {
      await owner.post(`/api/b/${businessId}/invitations`, { name: `P${i}`, email: `p${i}@example.com`, role: 'employee' });
    }
    for (let i = 0; i < 5; i++) {
      const token = tokenIn(await t.lastMessage(`p${i}@example.com`));
      await client(t.app).post('/api/invitations/accept', { token, name: `Person ${i}`, password: PASSWORD });
    }
    const seen = [];
    let cursor = null;
    do {
      const res = await owner.get(`/api/b/${businessId}/members?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...res.body.items.map((m) => m.name));
      cursor = res.body.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 6);
    assert.equal(new Set(seen).size, 6);
  });

  it('keeps the audit log append-only at the database level', async () => {
    await ownerWithBusiness(t);
    await assert.rejects(t.pool.query('UPDATE audit_logs SET action = \'x\''), /append-only/);
    await assert.rejects(t.pool.query('DELETE FROM audit_logs'), /append-only/);
  });
});
