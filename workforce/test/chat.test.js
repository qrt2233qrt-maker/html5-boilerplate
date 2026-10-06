import assert from 'node:assert/strict';
import { addMember, ownerWithBusiness, setup } from './helpers.js';

async function team(t) {
  const o = await ownerWithBusiness(t, { businessName: 'PizzaRita' });
  const B = (p) => `/api/b/${o.businessId}${p}`;
  const cook = await addMember(t, o.owner, o.businessId, { email: 'cook@pizzarita.test', name: 'Hassan Cook' });
  const driver = await addMember(t, o.owner, o.businessId, { email: 'driver@pizzarita.test', name: 'Ali Driver' });
  const mgr = await addMember(t, o.owner, o.businessId, { email: 'mgr@pizzarita.test', name: 'Omar Manager', role: 'manager' });
  return { ...o, B, cook, driver, mgr };
}

const teamId = async (c, B) => (await c.get(B('/chat/threads'))).body.find((x) => x.kind === 'team').id;

describe('chat', function () {
  let t;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => { await t.close(); });

  it('has one team chat everyone can read and write, with unread counts', async () => {
    const { owner, cook, driver, B } = await team(t);
    const id = await teamId(owner, B);
    assert.equal(await teamId(cook.member, B), id);
    const sent = await owner.post(B(`/chat/threads/${id}/messages`), { body: '  Big order for Friday night, all hands please  ' });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.body, 'Big order for Friday night, all hands please');
    assert.equal((await driver.member.get(B('/chat/unread'))).body.unread, 1);
    assert.equal((await owner.get(B('/chat/unread'))).body.unread, 0);
    await cook.member.post(B(`/chat/threads/${id}/messages`), { body: 'I will be there' });
    const page = (await driver.member.get(B(`/chat/threads/${id}/messages`))).body;
    assert.deepEqual(page.messages.map((m) => m.senderName), [sent.body.senderName, 'Hassan Cook']);
    assert.equal((await driver.member.get(B('/chat/unread'))).body.unread, 0);
    // Polling picks up only what is new.
    const last = page.messages.at(-1).id;
    await owner.post(B(`/chat/threads/${id}/messages`), { body: 'Thanks!' });
    const newer = (await driver.member.get(B(`/chat/threads/${id}/messages?after=${last}`))).body.messages;
    assert.deepEqual(newer.map((m) => m.body), ['Thanks!']);
    assert.equal((await cook.member.post(B(`/chat/threads/${id}/messages`), { body: '   ' })).body.error.code, 'empty_message');
  });

  it('keeps private chats between the two people only, the owner included', async () => {
    const { owner, cook, driver, B } = await team(t);
    const a = (await cook.member.post(B('/chat/direct'), { membershipId: driver.membershipId })).body.id;
    // Same pair, same thread, whoever opens it.
    assert.equal((await driver.member.post(B('/chat/direct'), { membershipId: cook.membershipId })).body.id, a);
    await cook.member.post(B(`/chat/threads/${a}/messages`), { body: 'Can you swap Saturday?' });
    assert.equal((await driver.member.get(B(`/chat/threads/${a}/messages`))).body.messages[0].body, 'Can you swap Saturday?');
    assert.equal((await owner.get(B(`/chat/threads/${a}/messages`))).status, 404);
    assert.equal((await owner.post(B(`/chat/threads/${a}/messages`), { body: 'hi' })).status, 404);
    assert.ok(!(await owner.get(B('/chat/threads'))).body.some((x) => x.id === a));
    assert.equal((await cook.member.post(B('/chat/direct'), { membershipId: cook.membershipId })).body.error.code, 'invalid_member');
  });

  it('lets people remove their own messages, and the owner moderate the team chat', async () => {
    const { owner, cook, driver, mgr, B } = await team(t);
    const id = await teamId(owner, B);
    const m1 = (await cook.member.post(B(`/chat/threads/${id}/messages`), { body: 'oops wrong chat' })).body;
    const m2 = (await driver.member.post(B(`/chat/threads/${id}/messages`), { body: 'something rude' })).body;
    assert.equal((await mgr.member.del(B(`/chat/threads/${id}/messages/${m2.id}`))).status, 403);
    assert.equal((await cook.member.del(B(`/chat/threads/${id}/messages/${m2.id}`))).status, 403);
    assert.equal((await cook.member.del(B(`/chat/threads/${id}/messages/${m1.id}`))).status, 200);
    assert.equal((await owner.del(B(`/chat/threads/${id}/messages/${m2.id}`))).status, 200);
    const msgs = (await mgr.member.get(B(`/chat/threads/${id}/messages`))).body.messages;
    assert.ok(msgs.every((m) => m.deleted && m.body === null));
    const { rows } = await t.pool.query('SELECT count(*)::int AS n FROM audit_logs WHERE action = \'chat.message_removed\'');
    assert.equal(rows[0].n, 1);
  });

  it('cuts off people who leave', async () => {
    const { owner, cook, driver, B } = await team(t);
    const a = (await cook.member.post(B('/chat/direct'), { membershipId: driver.membershipId })).body.id;
    await owner.post(B(`/members/${driver.membershipId}/suspend`));
    assert.equal((await driver.member.get(B('/chat/threads'))).status, 403);
    const r = await cook.member.post(B(`/chat/threads/${a}/messages`), { body: 'still there?' });
    assert.equal(r.status, 403);
    assert.equal((await cook.member.get(B('/chat/threads'))).body.find((x) => x.id === a).otherActive, false);
    assert.ok(!(await cook.member.get(B('/chat/people'))).body.some((p) => p.membershipId === driver.membershipId));
  });

  it('opens a private chat to discuss a holiday request', async () => {
    const { owner, cook, driver, mgr, B } = await team(t);
    await owner.put(B(`/members/${cook.membershipId}`), { reportsTo: mgr.membershipId });
    const at = (d) => new Date(Date.now() + d * 864e5).toISOString();
    const req = (await cook.member.post(B('/shift-requests'), { type: 'time_off', startsAt: at(10), endsAt: at(12), reason: 'Family wedding' })).body;
    const mine = (await cook.member.post(B('/chat/discuss'), { requestId: req.id })).body;
    const sent = await cook.member.post(B(`/chat/threads/${mine.threadId}/messages`), { body: 'Can we talk about my holiday?', refType: 'shift_request', refId: req.id });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    // The manager lands in the same conversation, and sees what it is about.
    const theirs = (await mgr.member.post(B('/chat/discuss'), { requestId: req.id })).body;
    assert.equal(theirs.threadId, mine.threadId);
    const msg = (await mgr.member.get(B(`/chat/threads/${theirs.threadId}/messages`))).body.messages[0];
    assert.equal(msg.ref.requestType, 'time_off');
    assert.equal(msg.ref.status, 'pending');
    // A colleague can't open someone else's request, or attach it to their own chats.
    assert.equal((await driver.member.post(B('/chat/discuss'), { requestId: req.id })).status, 404);
    const dm = (await driver.member.post(B('/chat/direct'), { membershipId: mgr.membershipId })).body.id;
    const r = await driver.member.post(B(`/chat/threads/${dm}/messages`), { body: 'look', refType: 'shift_request', refId: req.id });
    assert.equal(r.body.error.code, 'invalid_ref');
    const tid = await teamId(cook.member, B);
    assert.equal((await cook.member.post(B(`/chat/threads/${tid}/messages`), { body: 'x', refType: 'shift_request', refId: req.id })).body.error.code, 'invalid_ref');
  });
});
