import assert from 'node:assert/strict';
import { PASSWORD, client, setup, tokenIn } from './helpers.js';

// A server with no email or SMS service: nothing costs money, invitations
// and password resets are links the owner shares (WhatsApp, copy).
describe('without email or SMS (links shared by hand)', function () {
  let t;
  beforeEach(async () => { t = await setup({ EMAIL_TRANSPORT: 'none', SMS_TRANSPORT: 'none' }); });
  afterEach(async () => { await t.close(); });

  async function owner() {
    const o = client(t.app);
    const reg = await o.post('/api/auth/register', { businessName: 'PizzaRita', name: 'Layla Hassan', phone: '07701234567', password: PASSWORD });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    const me = await o.refresh();
    return { o, B: (p) => `/api/b/${me.businesses[0].id}${p}`, me };
  }

  it('tells the screens nothing can be sent', async () => {
    const r = await client(t.app).get('/api/config');
    assert.deepEqual(r.body, { email: false, sms: false, signup: true });
  });

  it('lets the owner sign up and go straight in, with no code', async () => {
    const { o, me } = await owner();
    assert.equal(me.businesses[0].verified, true);
    assert.equal((await o.get(`/api/b/${me.businesses[0].id}/`)).status, 200);
    await t.app.outbox.flush();
    assert.equal(t.sent.length, 0);
  });

  it('gives the invitation link to share, and the person joins with it', async () => {
    const { o, B } = await owner();
    const inv = await o.post(B('/invitations'), { name: 'Zainab', phone: '07709876543', role: 'employee' });
    assert.equal(inv.status, 201);
    assert.equal(inv.body.share.sentBy, null);
    assert.match(inv.body.share.link, /^http:\/\/app\.test\/#\/invite\?token=/);
    assert.ok(inv.body.share.message.includes(inv.body.share.link));
    // A new link replaces the old one.
    const again = (await o.post(B(`/invitations/${inv.body.id}/resend`))).body.share.link;
    assert.notEqual(again, inv.body.share.link);
    const z = client(t.app);
    assert.equal((await z.post('/api/invitations/accept', { token: tokenIn({ body: inv.body.share.link }), name: 'Zainab', password: 'till drawer green 51' })).status, 404);
    const ok = await z.post('/api/invitations/accept', { token: tokenIn({ body: again }), name: 'Zainab', password: 'till drawer green 51' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const me = await z.refresh();
    assert.equal(me.businesses[0].verified, true);
    await t.app.outbox.flush();
    assert.equal(t.sent.length, 0);
  });

  it('resets a forgotten password with a one-time link from the owner', async () => {
    const { o, B } = await owner();
    const inv = (await o.post(B('/invitations'), { name: 'Ali', phone: '07705550000', role: 'employee' })).body;
    const ali = client(t.app);
    await ali.post('/api/invitations/accept', { token: tokenIn({ body: inv.share.link }), name: 'Ali', password: 'morning tables 88' });
    const id = (await o.get(B('/members?q=Ali'))).body.items[0].membershipId;
    // Forgot password sends nothing (and says nothing about whether the account exists).
    assert.equal((await client(t.app).post('/api/auth/password/forgot', { identifier: '07705550000' })).status, 200);
    const r = await o.post(B(`/members/${id}/reset-link`));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const token = tokenIn({ body: r.body.link });
    const reset = await client(t.app).post('/api/auth/password/reset', { token, password: 'new tables evening 2026' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    // Old sessions are signed out; the link works once.
    assert.equal((await ali.get('/api/auth/me')).status, 401);
    assert.equal((await client(t.app).post('/api/auth/password/reset', { token, password: 'another long phrase 7' })).status, 400);
    const signIn = await client(t.app).post('/api/auth/login', { identifier: '07705550000', password: 'new tables evening 2026' });
    assert.equal(signIn.status, 200);
    const { rows } = await t.pool.query('SELECT count(*)::int AS n FROM audit_logs WHERE action = \'member.reset_link_created\'');
    assert.equal(rows[0].n, 1);
  });

  it('keeps reset links to people who may invite, and links for managers to the owner', async () => {
    const { o, B, me } = await owner();
    const join = async (name, phone, role) => {
      const inv = (await o.post(B('/invitations'), { name, phone, role })).body;
      const c = client(t.app);
      await c.post('/api/invitations/accept', { token: tokenIn({ body: inv.share.link }), name, password: `${name.toLowerCase()} long phrase 42` });
      await c.refresh();
      return { c, id: (await o.get(B(`/members?q=${name}`))).body.items[0].membershipId };
    };
    const mgr = await join('Omar', '07701111111', 'manager');
    const emp = await join('Hassan', '07702222222', 'employee');
    const mgr2 = await join('Sara', '07703333333', 'manager');
    assert.equal((await emp.c.post(B(`/members/${mgr.id}/reset-link`))).status, 403);
    // Managers can't invite unless the owner allows it, so they can't make links either.
    assert.equal((await mgr.c.post(B(`/members/${emp.id}/reset-link`))).status, 403);
    assert.equal((await o.post(B(`/members/${emp.id}/reset-link`))).status, 200);
    assert.equal((await o.post(B(`/members/${mgr2.id}/reset-link`))).status, 200);
    const ownerId = (await o.get(B('/members?role=owner'))).body.items[0].membershipId;
    assert.equal((await mgr.c.post(B(`/members/${ownerId}/reset-link`))).status, 403);
    assert.ok(me);
  });
});
