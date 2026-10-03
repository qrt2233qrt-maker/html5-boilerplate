// Opening hours and the usual shifts (morning, night…), set by the owner
// or a manager. Used by the timetable, the shift form and the schedule.
import { api } from './api.js';
import { t } from './i18n.js';
import { ICON } from './icons.js';
import { S, bpath } from './state.js';
import { isoToZoned } from './fmt.js';
import { closeSheet, openSheet, toast, toastError } from './ui.js';
import { $, $$, html, mount } from './util.js';

const FALLBACK = {
  opensAt: '04:00', closesAt: '02:00',
  shiftTypes: [{ key: 'morning', name: '', start: '04:00', end: '15:00' }, { key: 'night', name: '', start: '15:00', end: '02:00' }],
};

export const hours = () => S.settings?.hours || FALLBACK;
export const shiftTypes = () => hours().shiftTypes || [];

// The name to show: what the owner typed, else "Morning" / "Night".
export function typeName(st) {
  if (st.name) return st.name;
  const k = `shift_${st.key}`;
  const tx = t(k);
  return tx === k ? st.key : tx;
}

// The shift type a shift matches by its start and end time, if any.
export function typeOf(shift) {
  const a = isoToZoned(shift.startsAt).time;
  const b = isoToZoned(shift.endsAt).time;
  return shiftTypes().find((st) => st.start === a && st.end === b) || null;
}

// Minutes from midnight; a closing time at or before opening is next day.
export const minutesOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export function openWindow() {
  const h = hours();
  const open = minutesOf(h.opensAt);
  let close = minutesOf(h.closesAt);
  if (close <= open) close += 1440;
  return [open, close];
}

// Editor for opening hours and shift types.
export function hoursSheet(onDone) {
  const h = hours();
  const rows = h.shiftTypes.map((st) => ({ ...st, name: st.name || typeName(st) }));
  const row = (st, i) => html`<div class="st-row" data-i="${i}">
    <input class="input" name="name" value="${st.name}" placeholder="${t('shiftName')}" aria-label="${t('shiftName')}" maxlength="40">
    <input class="input" type="time" name="start" value="${st.start}" aria-label="${t('startTime')}">
    <span aria-hidden="true">–</span>
    <input class="input" type="time" name="end" value="${st.end}" aria-label="${t('endTime')}">
    <button class="iconbtn" type="button" data-del="${i}" aria-label="${t('remove')}">${ICON.x}</button></div>`;
  const sheet = openSheet({
    title: t('hoursAndShifts'),
    body: html`<p class="muted">${t('hoursAndShiftsBody')}</p>
      <form id="hours-form" novalidate><div class="form-error" role="alert"></div>
      <div class="form-grid">
        <div class="field"><label class="label" for="h-open">${t('opensAt')}</label><input class="input" type="time" id="h-open" value="${h.opensAt}" required></div>
        <div class="field"><label class="label" for="h-close">${t('closesAt')}</label><input class="input" type="time" id="h-close" value="${h.closesAt}" required>
          <p class="hint">${t('closesAtHint')}</p></div></div>
      <h3 class="h2 small">${t('shiftTypes')}</h3><div id="st-list"></div>
      <button class="btn small" type="button" id="st-add">${ICON.plus}${t('addShiftType')}</button></form>`,
    foot: html`<button class="btn primary" type="submit" form="hours-form">${t('save')}</button>`,
  });
  const list = $('#st-list', sheet);
  const read = () => $$('.st-row', list).map((r, i) => ({ key: rows[i]?.key || '', name: $('[name=name]', r).value, start: $('[name=start]', r).value, end: $('[name=end]', r).value }));
  const draw = () => {
    mount(list, html`${rows.map(row)}`);
    $$('[data-del]', list).forEach((b) => { b.onclick = () => { Object.assign(rows, read()); rows.splice(Number(b.dataset.del), 1); draw(); }; });
  };
  draw();
  $('#st-add', sheet).onclick = () => { const cur = read(); rows.length = 0; rows.push(...cur, { key: '', name: '', start: h.opensAt, end: h.closesAt }); draw(); };
  $('#hours-form', sheet).onsubmit = async (e) => {
    e.preventDefault();
    const body = { opensAt: $('#h-open', sheet).value, closesAt: $('#h-close', sheet).value, shiftTypes: read().filter((s) => s.start && s.end) };
    try {
      const saved = await api.put(bpath('/schedule/hours'), body);
      if (S.settings) S.settings.hours = saved;
      closeSheet();
      toast(t('saved'));
      onDone?.(saved);
    } catch (err) { $('.form-error', sheet).textContent = err.message; toastError(err); }
  };
}
