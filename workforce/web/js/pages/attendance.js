// Attendance (spec §5): clock in/out for everyone, records and corrections
// for managers.
import { api } from '../api.js';
import { t } from '../i18n.js';
import { ICON } from '../icons.js';
import { bpath, can } from '../state.js';
import { dayLabel, hours, isoToZoned, num, time, zonedToIso } from '../fmt.js';
import { dateRangeBar, empty, formSheet, rangeState } from '../components.js';
import { busy, openSheet, skeletonRows, toast, toastError } from '../ui.js';
import { $, html, mount } from '../util.js';

export const attendancePage = {
  title: () => t('attendance'),
  async render(view) {
    const manager = can('attendance.view');
    const range = rangeState('attendance', 'thisWeek');
    mount(view, html`<section class="panel" id="clock"></section>
      <div class="toolbar"><div id="range"></div><span class="spacer"></span>
        ${can('attendance.manage') ? html`<button class="btn small" type="button" id="add">${ICON.plus}${t('addRecord')}</button>` : ''}</div>
      ${manager ? html`<section class="panel" id="missed"></section>` : ''}
      <section id="list">${skeletonRows(5)}</section>`);
    const load = async (r) => {
      const [week, recs, missed, members] = await Promise.all([
        api.get(bpath('/me/week')),
        api.get(bpath(`/attendance?from=${r.from}&to=${r.to}${manager ? '' : '&mine=true'}`)),
        manager ? api.get(bpath(`/attendance/missed?from=${r.from}&to=${r.to}`)) : [],
        can('attendance.manage') && can('members.view') ? api.get(bpath('/members?status=active&limit=100')).then((x) => x.items) : [],
      ]);
      if (!view.isConnected) return;
      drawClock(view, week, () => load(r));
      if (manager) {
        mount($('#missed', view), html`<div class="panel-head"><h2>${t('missedShifts')}</h2><span class="pill ${missed.length ? 'over' : 'ok'} num">${missed.length}</span></div>
          ${missed.length ? html`<div class="listbox">${missed.slice(0, 20).map((m) => html`<div class="row"><span class="mid"><span class="t1">${m.memberName}</span>
            <span class="t2 num">${dayLabel(m.startsAt)} · ${time(m.startsAt)}–${time(m.endsAt)}</span></span>
            ${can('attendance.manage') ? html`<button class="btn small" type="button" data-fill='${JSON.stringify({ membershipId: m.membershipId, shiftId: m.id, startsAt: m.startsAt, endsAt: m.endsAt })}'>${t('addRecord')}</button>` : ''}</div>`)}</div>` : html`<p class="muted">${t('noMissed')}</p>`}`);
        $('#missed', view).onclick = (e) => { const b = e.target.closest('[data-fill]'); if (b) recordSheet(members, JSON.parse(b.dataset.fill), () => load(r)); };
      }
      const total = recs.reduce((a, x) => a + (x.hours || 0), 0);
      mount($('#list', view), recs.length ? html`<p class="muted small">${t('totalWorked')}: <b class="num">${hours(total)}</b></p>
        <div class="tablewrap"><table class="data"><thead><tr>${manager ? html`<th>${t('person')}</th>` : ''}<th>${t('date')}</th><th>${t('clockIn')}</th><th>${t('clockOut')}</th><th>${t('break')}</th><th>${t('hoursCol')}</th><th>${t('late')}</th><th></th></tr></thead>
        <tbody>${recs.map((a) => html`<tr>${manager ? html`<td>${a.memberName}</td>` : ''}<td>${dayLabel(a.clockIn)}</td><td class="num">${time(a.clockIn)}</td>
          <td class="num">${a.clockOut ? time(a.clockOut) : html`<span class="pill ok">${t('st_working')}</span>`}</td><td class="num">${a.breakMinutes ? `${a.breakMinutes}′` : '—'}</td>
          <td class="num">${a.hours === null ? '—' : num(a.hours)}</td><td class="num">${a.lateMinutes ? html`<span class="pill warn">${a.lateMinutes}′</span>` : '—'}</td>
          <td>${a.source === 'manager' ? html`<button class="btn small ghost" type="button" data-hist="${a.id}">${t('history')}</button>` : ''}
            ${can('attendance.manage') ? html`<button class="btn small ghost" type="button" data-edit="${a.id}">${t('correct')}</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : empty(t('noAttendance')));
      $('#list', view).onclick = async (e) => {
        const ed = e.target.closest('[data-edit]');
        if (ed) return adjustSheet(recs.find((x) => x.id === ed.dataset.edit), () => load(r));
        const h = e.target.closest('[data-hist]');
        if (h) {
          const items = await api.get(bpath(`/attendance/${h.dataset.hist}/history`));
          openSheet({ title: t('history'), body: html`<ol class="timeline">${items.map((x) => html`<li><b>${t(`hist_${x.changeType}`)}</b>
            <span class="muted small">${x.changedBy} · ${dayLabel(x.createdAt)}</span>
            ${x.before ? html`<span class="small num">${time(x.before.clockIn)}–${x.before.clockOut ? time(x.before.clockOut) : '…'} → ${time(x.after.clockIn)}–${x.after.clockOut ? time(x.after.clockOut) : '…'}</span>` : ''}
            ${x.reason ? html`<span class="small">“${x.reason}”</span>` : ''}</li>`)}</ol>` });
        }
      };
      const add = $('#add', view);
      if (add) add.onclick = () => recordSheet(members, null, () => load(r));
    };
    dateRangeBar($('#range', view), 'attendance', range, load);
    load(range).catch(toastError);
  },
};

function drawClock(view, week, reload) {
  const c = week.clockedIn;
  const s = week.today[0];
  mount($('#clock', view), html`<div class="clock-card"><span class="ic">${ICON.clock}</span>
    <div class="mid"><b>${c ? t('clockedInSince', { time: time(c.since) }) : t('notClockedIn')}</b>
      <span class="muted small">${s ? `${t('todaysShift')}: ${time(s.startsAt)}–${time(s.endsAt)}` : t('noShiftToday')}</span></div>
    ${c ? html`<input class="input brk" type="number" min="0" max="600" id="brk" placeholder="${t('breakMinutes')}" aria-label="${t('breakMinutes')}">` : ''}
    <button class="btn ${c ? '' : 'primary'}" type="button" id="clockbtn">${c ? t('clockOut') : t('clockIn')}</button></div>`);
  $('#clockbtn', view).onclick = async (e) => {
    // Keep the button: the event's currentTarget is cleared once we await.
    const btn = e.currentTarget;
    busy(btn);
    try {
      if (c) await api.post(bpath('/attendance/clock-out'), { breakMinutes: Number($('#brk', view)?.value || 0) });
      else await api.post(bpath('/attendance/clock-in'), {});
      toast(c ? t('clockedOut') : t('clockedIn'));
      reload();
    } catch (err) { busy(btn, false); toastError(err); }
  };
}

function recordSheet(members, preset, reload) {
  const a = preset ? isoToZoned(preset.startsAt) : null;
  const b = preset ? isoToZoned(preset.endsAt) : null;
  formSheet({
    title: t('addRecord'),
    fields: [
      { name: 'membershipId', label: t('person'), type: 'select', required: true, value: preset?.membershipId || '', options: members.map((m) => [m.membershipId, m.name]) },
      { name: 'in', label: t('clockIn'), type: 'datetime', required: true, value: a || {} },
      { name: 'out', label: t('clockOut'), type: 'datetime', value: b || {} },
      { name: 'breakMinutes', label: t('breakMinutes'), type: 'number', value: 0 },
      { name: 'note', label: t('note'), type: 'text', optional: true },
    ],
    onSubmit: async (v) => {
      await api.post(bpath('/attendance'), {
        membershipId: v.membershipId, shiftId: preset?.shiftId || null, clockIn: zonedToIso(v.in.day, v.in.time),
        clockOut: v.out.day && v.out.time ? zonedToIso(v.out.day, v.out.time) : null, breakMinutes: v.breakMinutes || 0, note: v.note || null,
      });
      reload();
    },
  });
}

function adjustSheet(rec, reload) {
  formSheet({
    title: t('correctRecord'), intro: rec.memberName,
    fields: [
      { name: 'in', label: t('clockIn'), type: 'datetime', required: true, value: isoToZoned(rec.clockIn) },
      { name: 'out', label: t('clockOut'), type: 'datetime', value: rec.clockOut ? isoToZoned(rec.clockOut) : {} },
      { name: 'breakMinutes', label: t('breakMinutes'), type: 'number', value: rec.breakMinutes },
      { name: 'reason', label: t('reasonForChange'), type: 'textarea', required: true, full: true },
    ],
    onSubmit: async (v) => {
      await api.put(bpath(`/attendance/${rec.id}`), {
        clockIn: zonedToIso(v.in.day, v.in.time), clockOut: v.out.day && v.out.time ? zonedToIso(v.out.day, v.out.time) : null,
        breakMinutes: v.breakMinutes || 0, reason: v.reason,
      });
      reload();
    },
  });
}
