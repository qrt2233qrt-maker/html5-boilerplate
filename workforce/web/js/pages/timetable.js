// Team timetable: everyone's published shifts, one colour per person, by
// day, week or month. Tap a colleague's shift to ask them to swap.
import { api } from '../api.js';
import { t } from '../i18n.js';
import { ICON } from '../icons.js';
import { bpath, can, loadSettings } from '../state.js';
import { addDays, dayLabel, isoToZoned, shiftRange, time, todayLocal, weekStartOf } from '../fmt.js';
import { empty, formSheet } from '../components.js';
import { closeSheet, openSheet, skeletonRows, toast } from '../ui.js';
import { $, $$, LS, html, initials, mount } from '../util.js';
import { problemText } from './schedule.js';

const VIEWS = ['day', 'week', 'month'];
const st = { view: null, day: null, dept: '', focus: null };

const monthStart = (day) => `${day.slice(0, 8)}01`;
const monthEnd = (day) => {
  const [y, m] = day.split('-').map(Number);
  return `${day.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

function range() {
  if (st.view === 'day') return [st.day, st.day];
  if (st.view === 'week') { const f = weekStartOf(st.day); return [f, addDays(f, 6)]; }
  // Month: whole weeks around the month, so the grid has no gaps.
  const f = weekStartOf(monthStart(st.day));
  const l = monthEnd(st.day);
  let e = addDays(weekStartOf(l), 6);
  if (e < l) e = addDays(e, 7);
  return [f, e];
}

const step = () => ({ day: 1, week: 7 }[st.view]);
function move(dir) {
  if (st.view === 'month') {
    const [y, m] = st.day.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    st.day = d.toISOString().slice(0, 10);
  } else st.day = addDays(st.day, dir * step());
}

function title(from, to) {
  if (st.view === 'day') return dayLabel(st.day, { weekday: 'long', day: 'numeric', month: 'long' });
  if (st.view === 'week') return `${dayLabel(from, { day: 'numeric', month: 'short' })} – ${dayLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return dayLabel(st.day, { month: 'long', year: 'numeric' });
}

export const timetablePage = {
  title: () => t('teamTimetable'),
  async render(view, { query }) {
    await loadSettings();
    const saved = LS.get('tt-view');
    st.view = VIEWS.includes(query.get('v')) ? query.get('v') : st.view || (VIEWS.includes(saved) ? saved : 'week');
    st.day = /^\d{4}-\d{2}-\d{2}$/.test(query.get('d') || '') ? query.get('d') : st.day || todayLocal();
    draw(view);
  },
};

async function draw(view) {
  const [from, to] = range();
  mount(view, html`<div class="toolbar tt-tools">
      <div class="tabbar" role="tablist" aria-label="${t('view')}">${VIEWS.map((v) => html`<button type="button" role="tab" class="tabbtn" data-v="${v}" aria-selected="${st.view === v}">${t(`tt_${v}`)}</button>`)}</div>
      <div class="weeknav"><button class="iconbtn" type="button" data-m="-1" aria-label="${t('previous')}"><span class="flip">${ICON.chev}</span></button>
        <b class="num tt-title">${title(from, to)}</b>
        <button class="iconbtn" type="button" data-m="1" aria-label="${t('next')}">${ICON.chev}</button>
        <button class="btn small ghost" type="button" data-m="0">${t('today')}</button></div>
      <select class="input" id="tt-dept" aria-label="${t('department')}"><option value="">${t('allDepartments')}</option></select>
    </div>
    <div id="tt-legend" class="tt-legend"></div>
    <div id="tt-body">${skeletonRows(6)}</div>`);
  $$('[data-v]', view).forEach((b) => { b.onclick = () => { st.view = b.dataset.v; LS.set('tt-view', st.view); draw(view); }; });
  $$('[data-m]', view).forEach((b) => { b.onclick = () => { if (b.dataset.m === '0') st.day = todayLocal(); else move(Number(b.dataset.m)); draw(view); }; });
  api.get(bpath('/departments')).then((ds) => {
    const sel = $('#tt-dept', view);
    if (!sel) return;
    ds.filter((d) => !d.archivedAt).forEach((d) => sel.append(new Option(d.name, d.id, false, d.id === st.dept)));
    sel.onchange = () => { st.dept = sel.value; draw(view); };
  }).catch(() => {});

  const data = await api.get(bpath(`/timetable?from=${from}&to=${to}${st.dept ? `&departmentId=${st.dept}` : ''}`));
  if (!view.isConnected) return;
  const person = new Map(data.people.map((p) => [p.membershipId, p]));
  // Unassigned shifts anyone could pick up.
  person.set(null, { membershipId: null, name: t('openShift'), color: 'open', departmentName: '' });
  const shown = data.people.filter((p) => data.shifts.some((s) => s.membershipId === p.membershipId));
  // Legend: tap someone to pick out their days; tap again to show everyone.
  mount($('#tt-legend', view), html`${shown.map((p) => html`<button type="button" class="who-chip c${p.color} ${st.focus === p.membershipId ? 'on' : ''}" data-focus="${p.membershipId}" aria-pressed="${st.focus === p.membershipId}">
    <i class="dot"></i>${p.membershipId === data.me ? t('you') : p.name.split(' ')[0]}</button>`)}`);
  $$('[data-focus]', view).forEach((b) => { b.onclick = () => { st.focus = st.focus === b.dataset.focus ? null : b.dataset.focus; draw(view); }; });

  const body = $('#tt-body', view);
  if (!data.shifts.length) { mount(body, empty(t('ttEmpty'), t('ttEmptyBody'))); return; }
  const ctx = { data, person, from, to };
  ({ day: dayView, week: weekView, month: monthView })[st.view](body, ctx);
  body.classList.toggle('focusing', !!st.focus);
  $$('[data-shift]', body).forEach((el) => {
    if (st.focus && el.dataset.who !== st.focus) el.classList.add('dim');
    el.onclick = () => openShift(view, ctx, data.shifts.find((s) => s.id === el.dataset.shift));
  });
  $$('[data-day]', body).forEach((el) => { el.onclick = () => { st.view = 'day'; st.day = el.dataset.day; draw(view); }; });
}

const dayOf = (iso) => isoToZoned(iso).day;
const chipLabel = (s) => `${time(s.startsAt)}–${time(s.endsAt)}`;

function shiftChip(s, p, me, { withName = true } = {}) {
  return html`<button type="button" class="tt-chip c${p?.color ?? 0} ${s.membershipId === me ? 'mine' : ''}" data-shift="${s.id}" data-who="${s.membershipId}"
      aria-label="${p?.name ?? ''} ${shiftRange(s)}">
    ${withName ? html`<b>${s.membershipId === me ? t('you') : s.membershipId ? (p?.name ?? '').split(' ')[0] : p.name}</b>` : ''}<span class="num">${chipLabel(s)}</span>
    ${s.swapPending ? html`<span class="tt-badge" title="${t('swapWaiting')}">${ICON.swap}</span>` : ''}</button>`;
}

// ---------- week ----------

function weekView(body, { data, person, from }) {
  const days = [...Array(7)].map((_, i) => addDays(from, i));
  const today = todayLocal();
  const people = data.people.filter((p) => data.shifts.some((s) => s.membershipId === p.membershipId));
  if (data.shifts.some((s) => !s.membershipId)) people.push(person.get(null));
  const on = (id, d) => data.shifts.filter((s) => s.membershipId === id && dayOf(s.startsAt) === d);
  // Wide screens: a grid of people by days. Phones: one card per day.
  if (matchMedia('(min-width: 760px)').matches) {
    mount(body, html`<div class="tablewrap tt-grid-wrap"><table class="tt-grid">
      <thead><tr><th>${t('person')}</th>${days.map((d) => html`<th class="${d === today ? 'today' : ''}" data-day="${d}" role="button" tabindex="0">${dayLabel(d)}</th>`)}</tr></thead>
      <tbody>${people.map((p) => html`<tr class="${p.membershipId === data.me ? 'me' : ''}">
        <th scope="row"><span class="who c${p.color}"><i class="dot"></i><span><b>${p.membershipId === data.me ? `${p.name} (${t('you')})` : p.name}</b><small>${p.departmentName || ''}</small></span></span></th>
        ${days.map((d) => html`<td class="${d === today ? 'today' : ''}">${on(p.membershipId, d).map((s) => shiftChip(s, p, data.me, { withName: false }))}</td>`)}</tr>`)}</tbody>
    </table></div>`);
    return;
  }
  mount(body, html`<div class="tt-days">${days.map((d) => {
    const list = data.shifts.filter((s) => dayOf(s.startsAt) === d);
    return html`<section class="panel tt-daycard ${d === today ? 'today' : ''}"><button type="button" class="tt-dayhead" data-day="${d}">
        <b>${dayLabel(d, { weekday: 'long', day: 'numeric', month: 'short' })}</b><span class="muted small">${list.length ? t('peopleWorking', { n: new Set(list.map((s) => s.membershipId)).size }) : t('nobodyWorking')}</span></button>
      <div class="tt-list">${list.map((s) => shiftChip(s, person.get(s.membershipId), data.me))}</div></section>`;
  })}</div>`);
}

// ---------- day: a timeline of the day ----------

function dayView(body, { data, person }) {
  const list = data.shifts.filter((s) => dayOf(s.startsAt) === st.day);
  if (!list.length) { mount(body, empty(t('nobodyWorking'))); return; }
  const mins = (iso) => { const z = isoToZoned(iso); const [h, m] = z.time.split(':').map(Number); return (z.day === st.day ? 0 : 1440) + h * 60 + m; };
  const start = Math.max(0, Math.floor(Math.min(...list.map((s) => mins(s.startsAt))) / 60) * 60);
  const end = Math.min(48 * 60, Math.ceil(Math.max(...list.map((s) => mins(s.endsAt))) / 60) * 60);
  const span = Math.max(60, end - start);
  const hoursMarks = [];
  for (let m = start; m <= end; m += span > 12 * 60 ? 180 : 120) hoursMarks.push(m);
  const ids = [...new Set(list.map((s) => s.membershipId))];
  mount(body, html`<section class="panel tt-day">
    <div class="tt-axis" dir="ltr">${hoursMarks.map((m) => html`<span data-at="${((m - start) / span) * 100}">${String(Math.floor(m / 60) % 24).padStart(2, '0')}:00</span>`)}</div>
    ${ids.map((id) => {
      const p = person.get(id);
      return html`<div class="tt-lane"><span class="who c${p?.color ?? 0}"><i class="dot"></i><b>${id === data.me ? t('you') : p?.name}</b></span>
        <div class="tt-track" dir="ltr">${list.filter((s) => s.membershipId === id).map((s) => html`<button type="button" class="tt-bar c${p?.color ?? 0} ${id === data.me ? 'mine' : ''}"
            data-shift="${s.id}" data-who="${id}" data-l="${((mins(s.startsAt) - start) / span) * 100}" data-w="${((mins(s.endsAt) - mins(s.startsAt)) / span) * 100}"
            aria-label="${p?.name} ${shiftRange(s)}"><span class="num">${chipLabel(s)}</span></button>`)}</div></div>`;
    })}</section>`);
  // Positions go through CSSOM: inline style attributes are blocked by the CSP.
  $$('.tt-bar', body).forEach((b) => { b.style.setProperty('--l', `${b.dataset.l}%`); b.style.setProperty('--w', `${b.dataset.w}%`); });
  $$('.tt-axis span', body).forEach((s) => s.style.setProperty('--l', `${s.dataset.at}%`));
}

// ---------- month ----------

function monthView(body, { data, person, from, to }) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const month = st.day.slice(0, 7);
  const today = todayLocal();
  mount(body, html`<div class="tt-month">
    ${days.slice(0, 7).map((d) => html`<span class="tt-wd">${dayLabel(d, { weekday: 'short' })}</span>`)}
    ${days.map((d) => {
      const list = data.shifts.filter((s) => dayOf(s.startsAt) === d);
      return html`<button type="button" class="tt-cell ${d.slice(0, 7) === month ? '' : 'out'} ${d === today ? 'today' : ''}" data-day="${d}"
          aria-label="${dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${t('peopleWorking', { n: list.length })}">
        <span class="n num">${Number(d.slice(8))}</span>
        <span class="tt-dots">${list.slice(0, 6).map((s) => { const p = person.get(s.membershipId); return html`<i class="mini c${p?.color ?? 0} ${s.membershipId === data.me ? 'mine' : ''} ${st.focus && st.focus !== s.membershipId ? 'dim' : ''}" title="${p?.name} ${chipLabel(s)}">${s.membershipId ? initials(p?.name || '') : '+'}</i>`; })}
          ${list.length > 6 ? html`<i class="more">+${list.length - 6}</i>` : ''}</span></button>`;
    })}</div>`);
}

// ---------- a shift: details, and asking a colleague to swap ----------

async function openShift(view, { data, person }, s) {
  if (!s) return;
  const p = person.get(s.membershipId);
  const mine = s.membershipId === data.me;
  const future = new Date(s.startsAt) > Date.now() && s.status === 'scheduled';
  const canAsk = !mine && !!s.membershipId && future && can('self.swaps') && !s.swapPending;
  const sheet = openSheet({
    title: mine ? t('yourShift') : s.membershipId ? t('shiftOf', { name: p?.name ?? '' }) : t('openShift'),
    body: html`<div class="tt-detail c${p?.color ?? 0}"><span class="avatar" aria-hidden="true">${initials(p?.name || '')}</span>
        <div><b>${p?.name}</b><small>${[p?.jobTitle, s.departmentName || p?.departmentName].filter(Boolean).join(' · ')}</small></div></div>
      <dl class="kv"><dt>${t('date')}</dt><dd>${dayLabel(s.startsAt, { weekday: 'long', day: 'numeric', month: 'long' })}</dd>
        <dt>${t('time')}</dt><dd class="num">${chipLabel(s)}</dd>
        ${s.breakMinutes ? html`<dt>${t('breakMinutes')}</dt><dd class="num">${s.breakMinutes}</dd>` : ''}
        ${s.locationName ? html`<dt>${t('location')}</dt><dd>${s.locationName}</dd>` : ''}</dl>
      ${s.swapPending ? html`<p class="banner info">${t('swapWaiting')}</p>` : ''}
      <div class="action-list">
        ${canAsk ? html`<button class="btn primary" type="button" id="ask-swap">${ICON.swap}${t('askToSwap', { name: (p?.name ?? '').split(' ')[0] })}</button>` : ''}
        ${mine ? html`<a class="btn" href="#/schedule?mine=1&shift=${s.id}">${ICON.calendar}${t('changeOrGiveAway')}</a>` : ''}
        ${!mine && s.membershipId ? html`<button class="btn" type="button" id="chat-them">${ICON.chat}${t('messageName', { name: (p?.name ?? '').split(' ')[0] })}</button>` : ''}
      </div>
      ${!mine && s.membershipId && future && !can('self.swaps') ? html`<p class="hint">${t('swapsNotAllowed')}</p>` : ''}
      ${!s.membershipId ? html`<p class="hint">${t('openShiftHint')}</p>` : ''}`,
  });
  $('#chat-them', sheet)?.addEventListener('click', async () => {
    try { const r = await api.post(bpath('/chat/direct'), { membershipId: s.membershipId }); closeSheet(); location.hash = `#/chat?thread=${r.id}`; } catch (err) { toast(problemText(err) || err.message, { error: true }); }
  });
  $('#ask-swap', sheet)?.addEventListener('click', () => askSwap(view, s, p));
}

async function askSwap(view, theirs, p) {
  const today = todayLocal();
  const mine = (await api.get(bpath(`/shifts?from=${today}&to=${addDays(today, 60)}&mine=true`)))
    .filter((x) => x.status === 'scheduled' && x.published && new Date(x.startsAt) > Date.now());
  closeSheet();
  if (!mine.length) { toast(t('noShiftToOffer'), { ms: 6000 }); return; }
  setTimeout(() => formSheet({
    title: t('askToSwap', { name: (p?.name ?? '').split(' ')[0] }),
    intro: `${t('youGet')}: ${shiftRange(theirs)}`, submitLabel: t('askColleague'),
    fields: [
      { name: 'mine', label: t('youGive'), type: 'seg', full: true, options: mine.map((x) => [x.id, shiftRange(x)]) },
      { name: 'reason', label: t('reason'), type: 'textarea', optional: true, full: true },
    ],
    onSubmit: async (v, btn, form) => {
      if (!v.mine) { form.querySelector('#err-mine').textContent = t('e.required'); return false; }
      try { await api.post(bpath('/swaps'), { myShiftId: v.mine, targetShiftId: theirs.id, reason: v.reason || null }); } catch (err) { const tx = problemText(err); if (tx) err.message = tx; throw err; }
      toast(t('swapSentTo', { name: (p?.name ?? '').split(' ')[0] }));
      draw(view);
    },
  }), 350);
}
