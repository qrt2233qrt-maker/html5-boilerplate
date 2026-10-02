// Shift change, time-off and give-away requests, and two-person shift swaps.
import { transaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { auditB, business, inScope, managedScope, scopeSql } from '../lib/context.js';
import { notifyApprovers, notifyMember } from '../lib/notify.js';
import { can } from '../auth/session.js';
import { assertSchedulable, scheduleError, scheduleProblems, shiftHistory } from './scheduling.js';

const reqOut = (r) => ({
  id: r.id, type: r.type, membershipId: r.membership_id, memberName: r.member_name, shiftId: r.shift_id,
  shiftStartsAt: r.shift_starts_at ?? null, shiftEndsAt: r.shift_ends_at ?? null,
  requestedStartsAt: r.requested_starts_at, requestedEndsAt: r.requested_ends_at,
  takerMembershipId: r.taker_membership_id, takerName: r.taker_name ?? null, reason: r.reason,
  // Approved requests whose shift is over read as completed (spec §4 statuses).
  status: r.status === 'approved' && r.shift_ends_at && new Date(r.shift_ends_at) < new Date() ? 'completed' : r.status,
  reviewNote: r.review_note, reviewedAt: r.reviewed_at, reviewedBy: r.reviewer_name ?? null, createdAt: r.created_at,
});

const REQ_SELECT = `SELECT r.*, u.name AS member_name, tu.name AS taker_name, ru.name AS reviewer_name,
    s.starts_at AS shift_starts_at, s.ends_at AS shift_ends_at
  FROM shift_requests r JOIN memberships m ON m.id = r.membership_id JOIN users u ON u.id = m.user_id
  LEFT JOIN memberships tm ON tm.id = r.taker_membership_id LEFT JOIN users tu ON tu.id = tm.user_id
  LEFT JOIN users ru ON ru.id = r.reviewed_by LEFT JOIN shifts s ON s.id = r.shift_id`;

async function ownFutureShift(db, req, shiftId) {
  const { rows: [s] } = await db.query('SELECT * FROM shifts WHERE id = $1 AND business_id = $2 FOR UPDATE', [shiftId, req.member.businessId]);
  if (!s || s.membership_id !== req.member.id) throw notFound('This shift could not be found.');
  if (s.status !== 'scheduled' || new Date(s.starts_at) <= new Date()) throw conflict('shift_closed', 'Only upcoming scheduled shifts can be changed.');
  return s;
}

export async function listRequests(app, req, { mine, status, type }) {
  const params = [req.member.businessId];
  const where = ['r.business_id = $1'];
  if (mine || !can(req, 'shift_requests.approve')) {
    params.push(req.member.id);
    // Your own requests, plus open give-aways you could take.
    where.push(`(r.membership_id = $${params.length} OR r.taker_membership_id = $${params.length}
      OR (r.type = 'offer' AND r.status = 'pending' AND r.taker_membership_id IS NULL))`);
  } else {
    where.push(scopeSql(await managedScope(req), params));
  }
  if (status) { params.push(status); where.push(`r.status = $${params.length}`); }
  if (type) { params.push(type); where.push(`r.type = $${params.length}`); }
  const { rows } = await app.db.query(`${REQ_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 300`, params);
  return rows.map(reqOut);
}

export async function createRequest(app, req, input) {
  const perm = input.type === 'offer' ? 'self.swaps' : 'self.requests';
  if (!can(req, perm)) throw forbidden();
  const biz = await business(req);
  return transaction(app.db, async (db) => {
    let shift = null;
    if (input.type !== 'time_off') {
      if (!input.shiftId) throw badRequest('shift_required', 'Choose a shift.');
      shift = await ownFutureShift(db, req, input.shiftId);
      const dup = await db.query('SELECT 1 FROM shift_requests WHERE shift_id = $1 AND status = \'pending\'', [shift.id]);
      if (dup.rows[0]) throw conflict('already_requested', 'There is already a pending request for this shift.');
    }
    if (input.type !== 'offer') {
      if (!input.startsAt || !input.endsAt || new Date(input.endsAt) <= new Date(input.startsAt)) {
        throw badRequest('invalid_times', 'Choose a start and an end time.');
      }
    }
    if (input.type === 'change') {
      const problems = await scheduleProblems(db, biz, { membershipId: req.member.id, startsAt: input.startsAt, endsAt: input.endsAt, breakMinutes: shift.break_minutes, exclude: [shift.id] });
      if (problems.length) throw scheduleError(problems);
    }
    if (input.type === 'offer' && input.takerMembershipId) {
      if (input.takerMembershipId === req.member.id) throw badRequest('invalid_taker', 'Choose a colleague.');
      const problems = await scheduleProblems(db, biz, { membershipId: input.takerMembershipId, startsAt: shift.starts_at, endsAt: shift.ends_at, breakMinutes: shift.break_minutes });
      if (problems.length) throw scheduleError(problems);
    }
    const { rows: [r] } = await db.query(
      `INSERT INTO shift_requests (business_id, membership_id, type, shift_id, requested_starts_at, requested_ends_at, taker_membership_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [biz.id, req.member.id, input.type, shift?.id ?? null, input.startsAt ?? null, input.endsAt ?? null, input.takerMembershipId ?? null, input.reason ?? null]);
    await auditB(db, req, { action: 'shift_request.created', targetType: 'shift_request', targetId: r.id, after: { type: r.type, shiftId: r.shift_id } });
    if (input.type === 'offer' && input.takerMembershipId) {
      await notifyMember(db, biz.id, input.takerMembershipId, 'shift.offered', { requestId: r.id, startsAt: shift.starts_at });
    }
    await notifyApprovers(db, biz.id, 'shift_requests.approve', req.member.id, 'request.new', { requestId: r.id, type: r.type });
    return r.id;
  }).then((id) => getRequest(app, req, id));
}

export async function getRequest(app, req, id) {
  const { rows: [r] } = await app.db.query(`${REQ_SELECT} WHERE r.id = $1 AND r.business_id = $2`, [id, req.member.businessId]);
  if (!r) throw notFound();
  const involved = r.membership_id === req.member.id || r.taker_membership_id === req.member.id || (r.type === 'offer' && !r.taker_membership_id);
  if (!involved && !(can(req, 'shift_requests.approve') && (await inScope(req, r.membership_id)))) throw notFound();
  return reqOut(r);
}

export async function cancelRequest(app, req, id) {
  return transaction(app.db, async (db) => {
    const { rows: [r] } = await db.query('SELECT * FROM shift_requests WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
    if (!r || r.membership_id !== req.member.id) throw notFound();
    if (r.status !== 'pending') throw conflict('not_pending', 'Only pending requests can be cancelled.');
    await db.query('UPDATE shift_requests SET status = \'cancelled\', updated_at = now() WHERE id = $1', [id]);
    await auditB(db, req, { action: 'shift_request.cancelled', targetType: 'shift_request', targetId: id });
  });
}

// A colleague takes a shift that was offered to anyone (or to them).
export async function takeOffer(app, req, id) {
  if (!can(req, 'self.swaps')) throw forbidden();
  const biz = await business(req);
  await transaction(app.db, async (db) => {
    const { rows: [r] } = await db.query('SELECT * FROM shift_requests WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, biz.id]);
    if (!r || r.type !== 'offer') throw notFound();
    if (r.status !== 'pending' || (r.taker_membership_id && r.taker_membership_id !== req.member.id)) throw conflict('not_available', 'This shift has already been taken.');
    if (r.membership_id === req.member.id) throw badRequest('invalid_taker', 'You can\'t take your own shift.');
    const { rows: [s] } = await db.query('SELECT * FROM shifts WHERE id = $1', [r.shift_id]);
    await db.query('SELECT 1 FROM memberships WHERE id = $1 FOR UPDATE', [req.member.id]);
    await assertSchedulable(db, biz, { membershipId: req.member.id, startsAt: s.starts_at, endsAt: s.ends_at, breakMinutes: s.break_minutes });
    await db.query('UPDATE shift_requests SET taker_membership_id = $2, updated_at = now() WHERE id = $1', [id, req.member.id]);
    await notifyMember(db, biz.id, r.membership_id, 'shift.offer_taken', { requestId: id });
    await notifyApprovers(db, biz.id, 'shift_requests.approve', r.membership_id, 'request.new', { requestId: id, type: 'offer' });
  });
  return getRequest(app, req, id);
}

export async function reviewRequest(app, req, id, { approve, note }) {
  const biz = await business(req);
  await transaction(app.db, async (db) => {
    const { rows: [r] } = await db.query('SELECT * FROM shift_requests WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, biz.id]);
    if (!r) throw notFound();
    if (r.membership_id === req.member.id) throw forbidden('You can\'t approve your own request.');
    if (!(await inScope(req, r.membership_id))) throw forbidden();
    if (r.status !== 'pending') throw conflict('not_pending', 'This request has already been decided.');
    const extra = { requestType: r.type, requestId: r.id, approvalStatus: approve ? 'approved' : 'rejected', reason: r.reason };
    if (approve) {
      await db.query('SELECT 1 FROM memberships WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[r.membership_id, r.taker_membership_id].filter(Boolean)]);
      if (r.type === 'change') {
        const { rows: [s] } = await db.query('SELECT * FROM shifts WHERE id = $1 FOR UPDATE', [r.shift_id]);
        if (s.status !== 'scheduled' || s.membership_id !== r.membership_id) throw conflict('shift_changed', 'The shift changed since the request was made.');
        await assertSchedulable(db, biz, { membershipId: r.membership_id, startsAt: r.requested_starts_at, endsAt: r.requested_ends_at, breakMinutes: s.break_minutes, exclude: [s.id] });
        await db.query('UPDATE shifts SET starts_at = $2, ends_at = $3, updated_at = now() WHERE id = $1', [s.id, r.requested_starts_at, r.requested_ends_at]);
        await shiftHistory(db, req, s.id, 'updated', { startsAt: s.starts_at, endsAt: s.ends_at }, { startsAt: r.requested_starts_at, endsAt: r.requested_ends_at }, extra);
      } else if (r.type === 'offer') {
        if (!r.taker_membership_id) throw conflict('no_taker', 'Nobody has taken this shift yet.');
        const { rows: [s] } = await db.query('SELECT * FROM shifts WHERE id = $1 FOR UPDATE', [r.shift_id]);
        if (s.status !== 'scheduled' || s.membership_id !== r.membership_id) throw conflict('shift_changed', 'The shift changed since the request was made.');
        await assertSchedulable(db, biz, { membershipId: r.taker_membership_id, startsAt: s.starts_at, endsAt: s.ends_at, breakMinutes: s.break_minutes });
        await db.query('UPDATE shifts SET membership_id = $2, updated_at = now() WHERE id = $1', [s.id, r.taker_membership_id]);
        await shiftHistory(db, req, s.id, 'reassigned', { membershipId: s.membership_id }, { membershipId: r.taker_membership_id }, extra);
        await notifyMember(db, biz.id, r.taker_membership_id, 'shift.assigned', { shiftId: s.id, startsAt: s.starts_at, endsAt: s.ends_at });
      } else {
        // Time off: block the period and open up any shifts inside it.
        await db.query(
          'INSERT INTO unavailability (business_id, membership_id, starts_at, ends_at, reason) VALUES ($1, $2, $3, $4, $5)',
          [biz.id, r.membership_id, r.requested_starts_at, r.requested_ends_at, 'time_off']);
        const { rows: opened } = await db.query(
          `UPDATE shifts SET membership_id = NULL, updated_at = now() WHERE membership_id = $1 AND status = 'scheduled'
             AND starts_at < $3 AND ends_at > $2 RETURNING id`, [r.membership_id, r.requested_starts_at, r.requested_ends_at]);
        for (const s of opened) await shiftHistory(db, req, s.id, 'unassigned', { membershipId: r.membership_id }, { membershipId: null }, extra);
      }
    }
    await db.query(
      'UPDATE shift_requests SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, updated_at = now() WHERE id = $1',
      [id, approve ? 'approved' : 'rejected', req.auth.user.id, note ?? null]);
    await auditB(db, req, { action: approve ? 'shift_request.approved' : 'shift_request.rejected', targetType: 'shift_request', targetId: id, before: { status: 'pending' }, after: { status: approve ? 'approved' : 'rejected', note } });
    const type = r.type === 'time_off' ? (approve ? 'time_off.approved' : 'time_off.rejected') : (approve ? 'request.approved' : 'request.rejected');
    await notifyMember(db, biz.id, r.membership_id, type, { requestId: id, note });
  });
  return getRequest(app, req, id);
}

// ---------- swaps ----------

const swapOut = (r) => ({
  id: r.id, status: r.status, reason: r.reason, reviewNote: r.review_note, createdAt: r.created_at,
  requester: { membershipId: r.requester_membership_id, name: r.requester_name, shiftId: r.requester_shift_id, startsAt: r.rs_start, endsAt: r.rs_end },
  target: { membershipId: r.target_membership_id, name: r.target_name, shiftId: r.target_shift_id, startsAt: r.ts_start, endsAt: r.ts_end },
  peerRespondedAt: r.peer_responded_at, reviewedAt: r.reviewed_at, reviewedBy: r.reviewer_name ?? null,
});

const SWAP_SELECT = `SELECT w.*, ru.name AS requester_name, tu.name AS target_name, vu.name AS reviewer_name,
    rs.starts_at AS rs_start, rs.ends_at AS rs_end, ts.starts_at AS ts_start, ts.ends_at AS ts_end
  FROM shift_swaps w JOIN memberships rm ON rm.id = w.requester_membership_id JOIN users ru ON ru.id = rm.user_id
  JOIN memberships tm ON tm.id = w.target_membership_id JOIN users tu ON tu.id = tm.user_id
  JOIN shifts rs ON rs.id = w.requester_shift_id JOIN shifts ts ON ts.id = w.target_shift_id
  LEFT JOIN users vu ON vu.id = w.reviewed_by`;

export async function listSwaps(app, req, { mine, status }) {
  const params = [req.member.businessId];
  const where = ['w.business_id = $1'];
  if (mine || !can(req, 'swaps.approve')) {
    params.push(req.member.id);
    where.push(`(w.requester_membership_id = $${params.length} OR w.target_membership_id = $${params.length})`);
  } else {
    const scope = await managedScope(req);
    if (scope) {
      const c1 = scopeSql(scope, params, 'rm');
      const c2 = scopeSql(scope, params, 'tm');
      where.push(`(${c1} AND ${c2})`);
    }
  }
  if (status) { params.push(status); where.push(`w.status = $${params.length}`); }
  const { rows } = await app.db.query(`${SWAP_SELECT} WHERE ${where.join(' AND ')} ORDER BY w.created_at DESC LIMIT 300`, params);
  return rows.map(swapOut);
}

export async function getSwap(app, req, id) {
  const { rows: [r] } = await app.db.query(`${SWAP_SELECT} WHERE w.id = $1 AND w.business_id = $2`, [id, req.member.businessId]);
  if (!r) throw notFound();
  const mine = r.requester_membership_id === req.member.id || r.target_membership_id === req.member.id;
  if (!mine && !(can(req, 'swaps.approve') && (await inScope(req, r.requester_membership_id)) && (await inScope(req, r.target_membership_id)))) throw notFound();
  return swapOut(r);
}

// Problems if A takes B's shift and B takes A's.
async function swapProblems(db, biz, a, b) {
  const both = [a.id, b.id];
  const pa = await scheduleProblems(db, biz, { membershipId: a.membership_id, startsAt: b.starts_at, endsAt: b.ends_at, breakMinutes: b.break_minutes, exclude: both });
  const pb = await scheduleProblems(db, biz, { membershipId: b.membership_id, startsAt: a.starts_at, endsAt: a.ends_at, breakMinutes: a.break_minutes, exclude: both });
  return [...pa.map((p) => ({ ...p, who: 'requester' })), ...pb.map((p) => ({ ...p, who: 'target' }))];
}

export async function createSwap(app, req, { myShiftId, targetShiftId, reason }) {
  if (!can(req, 'self.swaps')) throw forbidden();
  const biz = await business(req);
  const id = await transaction(app.db, async (db) => {
    const mine = await ownFutureShift(db, req, myShiftId);
    const { rows: [theirs] } = await db.query('SELECT * FROM shifts WHERE id = $1 AND business_id = $2 FOR UPDATE', [targetShiftId, biz.id]);
    if (!theirs || !theirs.membership_id || theirs.membership_id === req.member.id || !theirs.published) throw notFound('The other shift could not be found.');
    if (theirs.status !== 'scheduled' || new Date(theirs.starts_at) <= new Date()) throw conflict('shift_closed', 'Only upcoming scheduled shifts can be swapped.');
    const busy = await db.query(
      `SELECT 1 FROM shift_swaps WHERE status IN ('pending_peer', 'pending_approval')
         AND (requester_shift_id = ANY($1::uuid[]) OR target_shift_id = ANY($1::uuid[]))`, [[mine.id, theirs.id]]);
    if (busy.rows[0]) throw conflict('already_requested', 'One of these shifts already has a swap waiting.');
    const problems = await swapProblems(db, biz, mine, theirs);
    if (problems.length) throw scheduleError(problems);
    const { rows: [w] } = await db.query(
      `INSERT INTO shift_swaps (business_id, requester_membership_id, requester_shift_id, target_membership_id, target_shift_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [biz.id, req.member.id, mine.id, theirs.membership_id, theirs.id, reason ?? null]);
    await auditB(db, req, { action: 'swap.requested', targetType: 'shift_swap', targetId: w.id, after: { myShiftId, targetShiftId } });
    await notifyMember(db, biz.id, theirs.membership_id, 'swap.requested', { swapId: w.id });
    return w.id;
  });
  return getSwap(app, req, id);
}

export async function respondSwap(app, req, id, accept) {
  const biz = await business(req);
  await transaction(app.db, async (db) => {
    const { rows: [w] } = await db.query('SELECT * FROM shift_swaps WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, biz.id]);
    if (!w || w.target_membership_id !== req.member.id) throw notFound();
    if (w.status !== 'pending_peer') throw conflict('not_pending', 'This swap is no longer waiting for you.');
    await db.query('UPDATE shift_swaps SET status = $2, peer_responded_at = now(), updated_at = now() WHERE id = $1', [id, accept ? 'pending_approval' : 'rejected']);
    await auditB(db, req, { action: accept ? 'swap.accepted_by_colleague' : 'swap.declined_by_colleague', targetType: 'shift_swap', targetId: id });
    await notifyMember(db, biz.id, w.requester_membership_id, accept ? 'swap.accepted' : 'swap.rejected', { swapId: id });
    if (accept) await notifyApprovers(db, biz.id, 'swaps.approve', w.requester_membership_id, 'swap.awaiting_approval', { swapId: id });
  });
  return getSwap(app, req, id);
}

export async function cancelSwap(app, req, id) {
  await transaction(app.db, async (db) => {
    const { rows: [w] } = await db.query('SELECT * FROM shift_swaps WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
    if (!w || w.requester_membership_id !== req.member.id) throw notFound();
    if (!['pending_peer', 'pending_approval'].includes(w.status)) throw conflict('not_pending', 'Only pending swaps can be cancelled.');
    await db.query('UPDATE shift_swaps SET status = \'cancelled\', updated_at = now() WHERE id = $1', [id]);
    await auditB(db, req, { action: 'swap.cancelled', targetType: 'shift_swap', targetId: id });
    if (w.status === 'pending_peer') await notifyMember(db, req.member.businessId, w.target_membership_id, 'swap.cancelled', { swapId: id });
  });
}

// Manager decision. On approval both schedules change together (spec §5).
export async function reviewSwap(app, req, id, { approve, note }) {
  const biz = await business(req);
  await transaction(app.db, async (db) => {
    const { rows: [w] } = await db.query('SELECT * FROM shift_swaps WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, biz.id]);
    if (!w) throw notFound();
    if ([w.requester_membership_id, w.target_membership_id].includes(req.member.id)) throw forbidden('You can\'t approve a swap you are part of.');
    if (!(await inScope(req, w.requester_membership_id)) || !(await inScope(req, w.target_membership_id))) throw forbidden();
    if (w.status !== 'pending_approval') throw conflict('not_pending', w.status === 'pending_peer' ? 'The colleague hasn\'t accepted this swap yet.' : 'This swap has already been decided.');
    if (approve) {
      await db.query('SELECT 1 FROM memberships WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[w.requester_membership_id, w.target_membership_id]]);
      const { rows } = await db.query('SELECT * FROM shifts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[w.requester_shift_id, w.target_shift_id]]);
      const a = rows.find((s) => s.id === w.requester_shift_id);
      const b = rows.find((s) => s.id === w.target_shift_id);
      const unchanged = a.membership_id === w.requester_membership_id && b.membership_id === w.target_membership_id
        && a.status === 'scheduled' && b.status === 'scheduled' && new Date(a.starts_at) > new Date() && new Date(b.starts_at) > new Date();
      if (!unchanged) throw conflict('shift_changed', 'One of the shifts changed since the swap was requested.');
      const problems = await swapProblems(db, biz, a, b);
      if (problems.length) throw scheduleError(problems);
      await db.query('UPDATE shifts SET membership_id = $2, updated_at = now() WHERE id = $1', [a.id, b.membership_id]);
      await db.query('UPDATE shifts SET membership_id = $2, updated_at = now() WHERE id = $1', [b.id, a.membership_id]);
      const extra = { requestType: 'swap', requestId: id, approvalStatus: 'approved', reason: w.reason };
      await shiftHistory(db, req, a.id, 'swapped', { membershipId: a.membership_id }, { membershipId: b.membership_id }, extra);
      await shiftHistory(db, req, b.id, 'swapped', { membershipId: b.membership_id }, { membershipId: a.membership_id }, extra);
    }
    await db.query(
      'UPDATE shift_swaps SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, updated_at = now() WHERE id = $1',
      [id, approve ? 'approved' : 'rejected', req.auth.user.id, note ?? null]);
    await auditB(db, req, { action: approve ? 'swap.approved' : 'swap.rejected', targetType: 'shift_swap', targetId: id, after: { note } });
    for (const mid of [w.requester_membership_id, w.target_membership_id]) {
      await notifyMember(db, biz.id, mid, approve ? 'swap.approved' : 'swap.rejected', { swapId: id, note });
    }
  });
  return getSwap(app, req, id);
}

// Colleagues' upcoming shifts this shift could be swapped with, already
// checked against every schedule rule (names and times only).
export async function swapCandidates(app, req, shiftId) {
  const biz = await business(req);
  const { rows: [mine] } = await app.db.query('SELECT * FROM shifts WHERE id = $1 AND business_id = $2', [shiftId, biz.id]);
  if (!mine || mine.membership_id !== req.member.id) throw notFound();
  const { rows } = await app.db.query(
    `SELECT s.*, u.name AS member_name FROM shifts s JOIN memberships m ON m.id = s.membership_id JOIN users u ON u.id = m.user_id
      WHERE s.business_id = $1 AND s.membership_id <> $2 AND s.status = 'scheduled' AND s.published AND m.status = 'active'
        AND s.starts_at > now() AND s.starts_at BETWEEN $3::timestamptz - interval '14 days' AND $3::timestamptz + interval '14 days'
        AND ($4::uuid IS NULL OR s.department_id IS NULL OR s.department_id = $4)
      ORDER BY abs(extract(epoch FROM (s.starts_at - $3::timestamptz))) LIMIT 40`, [biz.id, req.member.id, mine.starts_at, mine.department_id]);
  const out = [];
  for (const s of rows) {
    if ((await swapProblems(app.db, biz, mine, s)).length) continue;
    out.push({ id: s.id, memberName: s.member_name, startsAt: s.starts_at, endsAt: s.ends_at });
    if (out.length >= 20) break;
  }
  return out.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}
