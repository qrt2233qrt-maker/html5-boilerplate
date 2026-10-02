// Schedule: week timetable for managers, "My schedule" for everyone else
// (spec §3, §4, §38-39).
import { api } from '../api.js';
import { t } from '../i18n.js';
import { ICON } from '../icons.js';
import { bpath, can, loadSettings } from '../state.js';
import { addDays, dayLabel, hours, isoToZoned, shiftRange, time, todayLocal, weekStartOf, zonedToIso } from '../fmt.js';
import { empty, formSheet, statusPill } from '../components.js';
import { busy, confirmDialog, openSheet, skeletonRows, toast, toastError } from '../ui.js';
import { $, $$, html, initials, mount } from '../util.js';

// Human text for schedule-rule problems returned by the server.
export function problemText(err) {
  const ps = err?.details?.problems;
  if (err?.code !== 'schedule_conflict' || !ps?.length) return null;
  return ps.map((p) => t(`rule_${p.rule}`, { limit: p.limit ?? '', hours: p.hours ?? '' })).join(' ');
}

export function showError(err) {
  const text = problemText(err);
  if (text) toast(text, { error: true, ms: 8000 }); else toastError(err);
}

const st = { week: null, departmentId: '', mine: false };

export const schedulePage = {
  title: () => (can('schedules.view') ? t('schedule') : t('mySchedule')),
  async render(view, { query }) {
    await loadSettings();
    st.week ||= weekStartOf(todayLocal());
    const manager = can('schedules.view');
    if (manager && query.get('mine') !== '1') return teamWeek(view, query);
    return mySchedule(view, query);
  },
};

// ---------- manager: week grid ----------

async function teamWeek(view, query) {
  const from = st.week;
  const to = addDays(from, 6);
  const days = [...Array(7)].map((_, i) => addDays(from, i));
  const canEdit = can('schedules.manage');
  mount(view, html`<div class="toolbar">
      <div class="weeknav"><button class="iconbtn" type="button" data-w="-7" aria-label="${t('prevWeek')}"><span class="flip">${ICON.chev}</span></button>
        <b class="num">${dayLabel(from, { day: 'numeric', month: 'short' })} – ${dayLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}</b>
        <button class="iconbtn" type="button" data-w="7" aria-label="${t('nextWeek')}">${ICON.chev}</button>
        <button class="btn small ghost" type="button" data-w="0">${t('thisWeek')}</button></div>
      <select class="input" id="dept" aria-label="${t('department')}"><option value="">${t('allDepartments')}</option></select>
      <span class="spacer"></span>
      ${canEdit ? html`<button class="btn small" type="button" id="copy">${ICON.repeat}${t('copyLastWeek')}</button>
        <button class="btn small primary" type="button" id="publish">${t('publishWeek')}</button>` : ''}
      <a class="btn small ghost" href="#/schedule?mine=1">${t('mySchedule')}</a>
    </div>
    <div id="grid">${skeletonRows(6)}</div>
    <p class="hint">${t('scheduleHint')}</p>`);
  $$('[data-w]', view).forEach((b) => { b.onclick = () => { st.week = b.dataset.w === '0' ? weekStartOf(todayLocal()) : addDays(st.week, Number(b.dataset.w)); teamWeek(view, query); }; });

  let members = [];
  let cursor = null;
  do {
    const r = await api.get(bpath(`/members?status=active&limit=100${cursor ? `&cursor=${cursor}` : ''}`));
    members = members.concat(r.items);
    cursor = r.nextCursor;
  } while (cursor && members.length < 500);
  const [shifts, depts, locations] = await Promise.all([
    api.get(bpath(`/shifts?from=${from}&to=${to}${st.departmentId ? `&departmentId=${st.departmentId}` : ''}`)),
    api.get(bpath('/departments')), api.get(bpath('/locations')),
  ]);
  if (!view.isConnected) return;
  const sel = $('#dept', view);
  for (const d of depts.filter((x) => !x.archivedAt)) sel.append(new Option(d.name, d.id, false, d.id === st.departmentId));
  sel.onchange = () => { st.departmentId = sel.value; teamWeek(view, query); };
  const people = members.filter((m) => m.role !== 'owner' || shifts.some((s) => s.membershipId === m.membershipId))
    .filter((m) => !st.departmentId || m.departmentId === st.departmentId);
  const byCell = new Map();
  for (const s of shifts) {
    const key = `${s.membershipId || 'open'}|${isoToZoned(s.startsAt).day}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(s);
  }
  const chip = (s) => html`<button type="button" class="shift-chip ${s.published ? '' : 'draft'} ${s.status}" data-shift="${s.id}">
    <span class="num">${time(s.startsAt)}–${time(s.endsAt)}</span>${s.published ? '' : html`<small>${t('draft')}</small>`}</button>`;
  const rowFor = (id, label, sub) => {
    const total = shifts.filter((s) => (s.membershipId || 'open') === id && s.status !== 'cancelled').reduce((a, s) => a + s.hours, 0);
    return html`<tr><th scope="row"><span class="who"><span class="avatar sm">${initials(label)}</span><span><bdi>${label}</bdi><small>${sub ? html`<bdi>${sub}</bdi>` : ''}${id !== 'open' ? html`${sub ? ' · ' : ''}<bdi class="num">${hours(total)}</bdi>` : ''}</small></span></span></th>
      ${days.map((d) => html`<td data-cell="${id}|${d}" class="${d === todayLocal() ? 'today' : ''}">${(byCell.get(`${id}|${d}`) || []).map(chip)}
        ${canEdit ? html`<button type="button" class="add-cell" data-add="${id}|${d}" aria-label="${t('addShift')}: ${label}, ${dayLabel(d)}">+</button>` : ''}</td>`)}</tr>`;
  };
  const drafts = shifts.filter((s) => !s.published && s.status === 'scheduled').length;
  mount($('#grid', view), html`<div class="tablewrap grid-wrap"><table class="week">
    <thead><tr><th></th>${days.map((d) => html`<th class="${d === todayLocal() ? 'today' : ''}">${dayLabel(d)}</th>`)}</tr></thead>
    <tbody>${rowFor('open', t('openShifts'), '')}${people.map((m) => rowFor(m.membershipId, m.name, m.profile.jobTitle || t(`role_${m.role}`)))}</tbody></table></div>
    ${people.length ? '' : empty(t('noPeopleYet'), '', html`<a class="btn primary" href="#/team?invite=1">${t('inviteSomeone')}</a>`)}`);
  const pub = $('#publish', view);
  if (pub) {
    pub.textContent = drafts ? `${t('publishWeek')} (${drafts})` : t('published');
    pub.disabled = !drafts;
    pub.onclick = async () => {
      busy(pub);
      try {
        const r = await api.post(bpath('/schedule/publish'), { from, to });
        toast(t('publishedToast', { n: r.published, people: r.people }));
        teamWeek(view, query);
      } catch (err) { busy(pub, false); toastError(err); }
    };
  }
  const copy = $('#copy', view);
  if (copy) copy.onclick = async () => {
    if (!(await confirmDialog({ title: t('copyLastWeekQ'), body: t('copyLastWeekBody'), confirm: t('copyLastWeek') }))) return;
    try {
      const r = await api.post(bpath('/schedule/copy-week'), { fromWeekStart: addDays(from, -7), toWeekStart: from });
      toast(t('copiedToast', { n: r.created, skipped: r.skipped.length }));
      teamWeek(view, query);
    } catch (err) { toastError(err); }
  };
  view.querySelector('#grid').onclick = (e) => {
    const s = e.target.closest('[data-shift]');
    if (s) return shiftSheet(view, query, shifts.find((x) => x.id === s.dataset.shift), { people, depts, locations });
    const a = e.target.closest('[data-add]');
    if (a) {
      const [mid, day] = a.dataset.add.split('|');
      editShift(view, query, null, { membershipId: mid === 'open' ? '' : mid, day }, { people, depts, locations });
    }
  };
  if (query.get('shift')) {
    const s = shifts.find((x) => x.id === query.get('shift'));
    if (s) shiftSheet(view, query, s, { people, depts, locations });
  }
}

function editShift(view, query, s, preset, refs) {
  const start = s ? isoToZoned(s.startsAt) : { day: preset.day, time: '09:00' };
  const end = s ? isoToZoned(s.endsAt) : { day: preset.day, time: '17:00' };
  formSheet({
    title: s ? t('editShift') : t('addShift'),
    fields: [
      { name: 'membershipId', label: t('person'), type: 'select', value: s ? s.membershipId || '' : preset.membershipId, blank: t('openShift'), options: refs.people.map((m) => [m.membershipId, m.name]) },
      { name: 'day', label: t('date'), type: 'date', value: start.day, required: true },
      { name: 'start', label: t('startTime'), type: 'time', value: start.time, required: true },
      { name: 'end', label: t('endTime'), type: 'time', value: end.time, required: true, hint: t('overnightHint') },
      { name: 'breakMinutes', label: t('breakMinutes'), type: 'number', value: s ? s.breakMinutes : 0, attrs: 'min="0" max="600"' },
      refs.depts.length ? { name: 'departmentId', label: t('department'), type: 'select', optional: true, value: s?.departmentId || '', options: refs.depts.filter((d) => !d.archivedAt).map((d) => [d.id, d.name]) } : null,
      refs.locations.length ? { name: 'locationId', label: t('location'), type: 'select', optional: true, value: s?.locationId || '', options: refs.locations.filter((d) => !d.archivedAt).map((d) => [d.id, d.name]) } : null,
      { name: 'notes', label: t('notes'), type: 'textarea', optional: true, value: s?.notes || '', full: true },
      s?.published ? { name: 'reason', label: t('reasonForChange'), type: 'text', optional: true } : { name: 'published', label: t('publishNow'), type: 'checkbox', value: false },
    ],
    onSubmit: async (v) => {
      const startsAt = zonedToIso(v.day, v.start);
      // An end time before the start means the shift runs past midnight.
      const endDay = v.end <= v.start ? addDays(v.day, 1) : v.day;
      const body = {
        membershipId: v.membershipId || null, startsAt, endsAt: zonedToIso(endDay, v.end), breakMinutes: v.breakMinutes || 0,
        departmentId: v.departmentId || null, locationId: v.locationId || null, notes: v.notes || null,
      };
      try {
        if (s) await api.put(bpath(`/shifts/${s.id}`), { ...body, reason: v.reason || null });
        else await api.post(bpath('/shifts'), { ...body, published: !!v.published });
      } catch (err) {
        const text = problemText(err);
        if (text) { err.message = text; err.code = 'schedule_conflict_text'; }
        throw err;
      }
      teamWeek(view, query);
    },
  });
}

async function shiftSheet(view, query, s, refs) {
  const full = await api.get(bpath(`/shifts/${s.id}`));
  const canEdit = can('schedules.manage') && full.status === 'scheduled';
  const sheet = openSheet({
    title: full.memberName || t('openShift'),
    body: html`<p class="lead num">${shiftRange(full)}</p>
      <div class="row-gap">${statusPill(full.status)}${full.published ? '' : html`<span class="pill">${t('draft')}</span>`}${full.rescheduled ? html`<span class="pill info">${t('st_rescheduled')}</span>` : ''}</div>
      <dl class="kv panel">${[[t('department'), full.departmentName], [t('location'), full.locationName], [t('breakMinutes'), full.breakMinutes || null], [t('notes'), full.notes]].filter(([, v]) => v).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
      <h3 class="h2 small">${t('history')}</h3>${historyList(full.history)}`,
    foot: canEdit ? html`<button class="btn danger" type="button" data-cancel>${t('cancelShift')}</button><button class="btn primary" type="button" data-edit>${t('edit')}</button>` : '',
  });
  sheet.querySelector('[data-edit]')?.addEventListener('click', () => editShift(view, query, full, {}, refs));
  sheet.querySelector('[data-cancel]')?.addEventListener('click', () => formSheet({
    title: t('cancelShift'), danger: true, submitLabel: t('cancelShift'),
    fields: [{ name: 'reason', label: t('reason'), type: 'text', required: true }],
    onSubmit: async (v) => { await api.post(bpath(`/shifts/${s.id}/cancel`), { reason: v.reason }); teamWeek(view, query); },
  }));
}

export function historyList(items) {
  if (!items?.length) return html`<p class="muted small">—</p>`;
  return html`<ol class="timeline">${items.map((h) => html`<li><b>${t(`hist_${h.changeType}`)}</b>
    <span class="muted small">${h.changedBy || t('system')} · ${dayLabel(h.createdAt, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
    ${h.before?.startsAt && h.after?.startsAt ? html`<span class="small num">${time(h.before.startsAt)}–${time(h.before.endsAt)} → ${time(h.after.startsAt)}–${time(h.after.endsAt)}</span>` : ''}
    ${h.requestType ? html`<span class="small">${t(`req_${h.requestType}`)} · ${t(`st_${h.approvalStatus || 'approved'}`)}</span>` : ''}
    ${h.reason ? html`<span class="small">“${h.reason}”</span>` : ''}</li>`)}</ol>`;
}

// ---------- my schedule ----------

async function mySchedule(view, query) {
  const today = todayLocal();
  const tab = query.get('tab') === 'past' ? 'past' : 'upcoming';
  const from = tab === 'past' ? addDays(today, -60) : today;
  const to = tab === 'past' ? addDays(today, -1) : addDays(today, 60);
  mount(view, html`<div class="toolbar"><div class="tabbar" role="tablist">
      <a role="tab" class="tabbtn" href="#/schedule?mine=1" aria-selected="${tab === 'upcoming'}">${t('upcoming')}</a>
      <a role="tab" class="tabbtn" href="#/schedule?mine=1&tab=past" aria-selected="${tab === 'past'}">${t('previous')}</a></div>
      <span class="spacer"></span>
      ${can('self.requests') ? html`<button class="btn small" type="button" id="timeoff">${ICON.calendar}${t('requestTimeOff')}</button>` : ''}
      <button class="btn small ghost" type="button" id="avail">${t('myAvailability')}</button></div>
    <div id="list">${skeletonRows(4)}</div>`);
  const shifts = await api.get(bpath(`/shifts?from=${from}&to=${to}&mine=true`));
  if (!view.isConnected) return;
  const list = tab === 'past' ? shifts.reverse() : shifts;
  const groups = new Map();
  for (const s of list) {
    const d = isoToZoned(s.startsAt).day;
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(s);
  }
  mount($('#list', view), list.length ? html`${[...groups].map(([d, items]) => html`<h3 class="dayhead">${d === today ? t('today') : dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
    <div class="listbox">${items.map((s) => html`<button class="row" type="button" data-shift="${s.id}">
      <span class="avatar">${ICON.clock}</span>
      <span class="mid"><span class="t1 num">${time(s.startsAt)} – ${time(s.endsAt)}</span><span class="t2">${[s.departmentName, s.locationName, hours(s.hours)].filter(Boolean).join(' · ')}</span></span>
      <span class="end">${s.rescheduled ? html`<span class="pill info">${t('st_rescheduled')}</span>` : ''}${statusPill(s.status === 'scheduled' && new Date(s.endsAt) < Date.now() ? 'completed' : s.status)}</span>
      <span class="chev">${ICON.chev}</span></button>`)}</div>`)}`
    : empty(tab === 'past' ? t('noPastShifts') : t('noUpcomingShifts'), t('noUpcomingBody')));
  $('#list', view).onclick = (e) => {
    const b = e.target.closest('[data-shift]');
    if (b) myShift(view, query, shifts.find((s) => s.id === b.dataset.shift));
  };
  $('#timeoff', view)?.addEventListener('click', () => timeOffSheet());
  $('#avail', view).onclick = () => availabilitySheet();
  const open = query.get('shift');
  if (open) { const s = shifts.find((x) => x.id === open); if (s) myShift(view, query, s); }
}

async function myShift(view, query, s) {
  const full = await api.get(bpath(`/shifts/${s.id}`));
  const future = full.status === 'scheduled' && new Date(full.startsAt) > Date.now();
  const sheet = openSheet({
    title: dayLabel(full.startsAt, { weekday: 'long', day: 'numeric', month: 'long' }),
    body: html`<p class="lead num">${time(full.startsAt)} – ${time(full.endsAt)}</p>
      <div class="row-gap">${statusPill(full.status)}${full.rescheduled ? html`<span class="pill info">${t('st_rescheduled')}</span>` : ''}</div>
      <dl class="kv panel">${[[t('department'), full.departmentName], [t('location'), full.locationName], [t('breakMinutes'), full.breakMinutes || null], [t('notes'), full.notes]].filter(([, v]) => v).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
      ${future ? html`<div class="action-list">
        ${can('self.requests') ? html`<button class="btn" type="button" data-a="change">${ICON.clock}${t('requestChange')}</button>` : ''}
        ${can('self.swaps') ? html`<button class="btn" type="button" data-a="swap">${ICON.swap}${t('swapShift')}</button>
          <button class="btn" type="button" data-a="offer">${ICON.send}${t('giveAway')}</button>` : ''}</div>` : ''}
      <h3 class="h2 small">${t('history')}</h3>${historyList(full.history)}`,
  });
  sheet.querySelectorAll('[data-a]').forEach((b) => {
    b.onclick = () => ({ change: changeSheet, swap: swapSheet, offer: offerSheet })[b.dataset.a](full);
  });
}

export function changeSheet(s) {
  const a = isoToZoned(s.startsAt);
  const b = isoToZoned(s.endsAt);
  formSheet({
    title: t('requestChange'), intro: shiftRange(s), submitLabel: t('sendRequest'),
    fields: [
      { name: 'day', label: t('newDate'), type: 'date', value: a.day, required: true },
      { name: 'start', label: t('startTime'), type: 'time', value: a.time, required: true },
      { name: 'end', label: t('endTime'), type: 'time', value: b.time, required: true },
      { name: 'reason', label: t('reason'), type: 'textarea', required: true, full: true },
    ],
    onSubmit: async (v) => {
      const endDay = v.end <= v.start ? addDays(v.day, 1) : v.day;
      try {
        await api.post(bpath('/shift-requests'), { type: 'change', shiftId: s.id, startsAt: zonedToIso(v.day, v.start), endsAt: zonedToIso(endDay, v.end), reason: v.reason });
      } catch (err) { const tx = problemText(err); if (tx) err.message = tx; throw err; }
      toast(t('requestSent'));
    },
  });
}

export async function swapSheet(s) {
  const options = await api.get(bpath(`/swaps/candidates/${s.id}`));
  if (!options.length) return toast(t('noSwapOptions'), { ms: 6000 });
  formSheet({
    title: t('swapShift'), intro: `${t('yourShift')}: ${shiftRange(s)}`, submitLabel: t('askColleague'),
    fields: [
      { name: 'target', label: t('swapWith'), type: 'seg', full: true, options: options.map((o) => [o.id, `${o.memberName} · ${shiftRange(o)}`]) },
      { name: 'reason', label: t('reason'), type: 'textarea', optional: true, full: true },
    ],
    onSubmit: async (v, btn, form) => {
      if (!v.target) { form.querySelector('#err-target').textContent = t('e.required'); return false; }
      try { await api.post(bpath('/swaps'), { myShiftId: s.id, targetShiftId: v.target, reason: v.reason || null }); } catch (err) { const tx = problemText(err); if (tx) err.message = tx; throw err; }
      toast(t('swapSent'));
    },
  });
}

function offerSheet(s) {
  formSheet({
    title: t('giveAway'), intro: `${shiftRange(s)} — ${t('giveAwayBody')}`, submitLabel: t('offerShift'),
    fields: [{ name: 'reason', label: t('reason'), type: 'textarea', optional: true, full: true }],
    onSubmit: async (v) => { await api.post(bpath('/shift-requests'), { type: 'offer', shiftId: s.id, reason: v.reason || null }); toast(t('offerSent')); },
  });
}

export function timeOffSheet() {
  const d = todayLocal();
  formSheet({
    title: t('requestTimeOff'), submitLabel: t('sendRequest'),
    fields: [
      { name: 'from', label: t('firstDayOff'), type: 'date', value: addDays(d, 1), required: true },
      { name: 'to', label: t('lastDayOff'), type: 'date', value: addDays(d, 1), required: true },
      { name: 'reason', label: t('reason'), type: 'textarea', required: true, full: true },
    ],
    onSubmit: async (v) => {
      await api.post(bpath('/shift-requests'), { type: 'time_off', startsAt: zonedToIso(v.from, '00:00'), endsAt: zonedToIso(addDays(v.to, 1), '00:00'), reason: v.reason });
      toast(t('requestSent'));
    },
  });
}

async function availabilitySheet() {
  const items = await api.get(bpath('/unavailability'));
  const sheet = openSheet({
    title: t('myAvailability'),
    body: html`<p class="muted">${t('availabilityBody')}</p>
      ${items.length ? html`<div class="listbox">${items.map((u) => html`<div class="row"><span class="mid"><span class="t1 num">${dayLabel(u.startsAt)} ${time(u.startsAt)} – ${dayLabel(u.endsAt)} ${time(u.endsAt)}</span><span class="t2">${u.reason === 'time_off' ? t('req_time_off') : u.reason || ''}</span></span>
        ${u.reason === 'time_off' ? '' : html`<button class="btn small ghost" type="button" data-del="${u.id}">${t('remove')}</button>`}</div>`)}</div>` : empty(t('alwaysAvailable'))}`,
    foot: html`<button class="btn primary" type="button" data-add>${t('addUnavailable')}</button>`,
  });
  sheet.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await api.del(bpath(`/unavailability/${b.dataset.del}`)); availabilitySheet(); }; });
  sheet.querySelector('[data-add]').onclick = () => formSheet({
    title: t('addUnavailable'),
    fields: [
      { name: 'from', label: t('from'), type: 'datetime', value: { day: todayLocal(), time: '00:00' }, required: true },
      { name: 'to', label: t('to'), type: 'datetime', value: { day: todayLocal(), time: '23:59' }, required: true },
      { name: 'reason', label: t('reason'), type: 'text', optional: true },
    ],
    onSubmit: async (v) => {
      await api.post(bpath('/unavailability'), { startsAt: zonedToIso(v.from.day, v.from.time), endsAt: zonedToIso(v.to.day, v.to.time), reason: v.reason || null });
      toast(t('saved'));
    },
  });
}

