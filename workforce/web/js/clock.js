// Clocking in and out at the restaurant: the phone's position plus the code
// shown at the door. Also the door screen managers keep on a tablet.
import { api } from './api.js';
import { LANG, t } from './i18n.js';
import { ICON } from './icons.js';
import { S, bpath, can } from './state.js';
import { time } from './fmt.js';
import { busy, errorMessage, openSheet, closeSheet, toast } from './ui.js';
import { $, html, mount, raw } from './util.js';

// One reading of the phone's position. Location is only read here, at the
// moment of clocking in or out; nothing tracks staff in between.
export function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(Object.assign(new Error('no geolocation'), { code: 'geo_unavailable' }));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(Object.assign(new Error(e.message), { code: e.code === 1 ? 'geo_denied' : e.code === 3 ? 'geo_timeout' : 'geo_unavailable' })),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

// Clock in (or out) at the door: reads the position, then sends it with the code.
export async function zoneClock({ out = false, locationId, code, breakMinutes = 0 }) {
  const where = { locationId, code, ...(await position()) };
  return out
    ? api.post(bpath('/attendance/clock-out'), { breakMinutes, ...where })
    : api.post(bpath('/attendance/clock-in'), where);
}

// Friendly text for location problems as well as the server's refusals.
export function clockError(err) {
  if (err?.code?.startsWith?.('geo_')) return t(`e.${err.code}`);
  if (err?.code === 'outside_zone' && err.details) return t('e.outside_zone_far', { m: err.details.distance, place: err.details.location });
  return errorMessage(err);
}

// The sheet behind the Clock in / Clock out buttons when the door is required:
// scan the QR with the camera, or type the code shown under it.
export async function zoneSheet({ out, onDone }) {
  const locs = (await api.get(bpath('/locations'))).filter((l) => !l.archivedAt && l.latitude !== null);
  const sheet = openSheet({
    title: out ? t('clockOut') : t('clockIn'),
    body: html`<div class="scan-hint"><span class="ic">${ICON.cam || ICON.clock}</span>
        <p>${t('scanDoorHint')}</p></div>
      <form id="zone-form" novalidate><div class="form-error" role="alert"></div>
        ${locs.length > 1 ? html`<div class="field"><label class="label" for="z-loc">${t('location')}</label>
          <select class="input" id="z-loc">${locs.map((l) => html`<option value="${l.id}">${l.name}</option>`)}</select></div>` : ''}
        <div class="field"><label class="label" for="z-code">${t('doorCode')}</label>
          <input class="input code-input" id="z-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" dir="ltr" placeholder="••••••"></div>
        ${out ? html`<div class="field"><label class="label" for="z-brk">${t('breakMinutes')}</label>
          <input class="input" id="z-brk" type="number" min="0" max="600" value="0" inputmode="numeric"></div>` : ''}
        <p class="hint">${t('locationPrivacy')}</p></form>`,
    foot: html`<button class="btn primary" type="submit" form="zone-form">${out ? t('clockOut') : t('clockIn')}</button>`,
  });
  const form = $('#zone-form', sheet);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('.sfoot .primary', sheet);
    const fe = $('.form-error', form);
    fe.textContent = '';
    const locationId = $('#z-loc', form)?.value || locs[0]?.id;
    busy(btn);
    try {
      await zoneClock({ out, locationId, code: $('#z-code', form).value, breakMinutes: Number($('#z-brk', form)?.value || 0) });
      closeSheet();
      toast(out ? t('clockedOut') : t('clockedIn'));
      onDone?.();
    } catch (err) {
      busy(btn, false);
      fe.textContent = clockError(err);
    }
  };
  $('#z-code', form).focus();
}

// Opened by scanning the door QR: clocks in straight away, or offers clock-out.
export const clockPage = {
  title: () => t('clockIn'),
  async render(view, { query }) {
    const locationId = query.get('l');
    const code = query.get('c');
    const week = await api.get(bpath('/me/week'));
    const out = !!week.clockedIn;
    const card = (body) => mount(view, html`<section class="panel clock-scan">${body}</section>`);
    const run = async (breakMinutes = 0) => {
      card(html`<div class="scan-state"><span class="spinner" aria-hidden="true"></span><p>${t('findingLocation')}</p></div>`);
      try {
        const r = await zoneClock({ out, locationId, code, breakMinutes });
        card(html`<div class="scan-state ok"><span class="big-tick">${ICON.check}</span>
          <h2>${out ? t('clockedOut') : t('clockedIn')}</h2>
          <p class="num">${time(out ? r.clockOut : r.clockIn)} · ${S.business.name}</p>
          <a class="btn primary" href="#/home">${t('home')}</a></div>`);
      } catch (err) {
        card(html`<div class="scan-state bad"><span class="big-x" aria-hidden="true">!</span>
          <h2>${out ? t('couldNotClockOut') : t('couldNotClockIn')}</h2><p>${clockError(err)}</p>
          ${err.code === 'invalid_door_code' ? html`<p class="hint">${t('scanAgainHint')}</p>` : html`<button class="btn primary" type="button" id="again">${t('tryAgain')}</button>`}
          <p class="hint">${t('locationPrivacy')}</p></div>`);
        $('#again', view)?.addEventListener('click', () => run(breakMinutes));
      }
    };
    if (!out) return run();
    card(html`<h2>${t('clockOut')}</h2><p class="muted">${t('clockedInSince', { time: time(week.clockedIn.since) })}</p>
      <div class="field"><label class="label" for="brk2">${t('breakMinutes')}</label>
        <input class="input" id="brk2" type="number" min="0" max="600" value="0" inputmode="numeric"></div>
      <button class="btn primary block" type="button" id="go">${t('clockOut')}</button>`);
    $('#go', view).onclick = () => run(Number($('#brk2', view).value || 0));
  },
};

// ---------- door screen (tablet at the entrance) ----------

let doorTimer = 0;
let wakeLock = null;

export const doorPage = {
  title: () => t('doorScreen'),
  async render(view, { query }) {
    clearTimeout(doorTimer);
    const locs = (await api.get(bpath('/locations'))).filter((l) => !l.archivedAt);
    const id = query.get('l') || (locs.length === 1 ? locs[0].id : null);
    if (!id) {
      mount(view, html`<section class="panel"><h2>${t('doorScreen')}</h2><p class="muted">${t('pickDoorLocation')}</p>
        <div class="listbox">${locs.map((l) => html`<a class="row" href="#/door?l=${l.id}"><span class="mid"><span class="t1">${l.name}</span></span><span class="chev">${ICON.chev}</span></a>`)}</div></section>`);
      return;
    }
    document.body.classList.add('kiosk');
    const leave = () => { if (!location.hash.startsWith('#/door')) { document.body.classList.remove('kiosk'); clearTimeout(doorTimer); wakeLock?.release?.().catch(() => {}); wakeLock = null; window.removeEventListener('hashchange', leave); } };
    window.addEventListener('hashchange', leave);
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* the screen may dim */ }
    const draw = async () => {
      if (!location.hash.startsWith('#/door')) return;
      let d;
      try { d = await api.get(bpath(`/locations/${id}/door`)); } catch (err) {
        mount(view, html`<section class="panel"><p class="bad">${errorMessage(err)}</p></section>`);
        doorTimer = setTimeout(draw, 15000);
        return;
      }
      const digits = `${d.code.slice(0, 3)} ${d.code.slice(3)}`;
      mount(view, html`<section class="door">
        <div class="door-head"><b>${d.businessName}</b><span>${d.locationName}</span></div>
        <div class="door-qr" aria-label="${t('doorQrLabel')}">${raw(d.qrSvg)}</div>
        <p class="door-code num" dir="ltr">${digits}</p>
        <p class="door-hint">${t('doorHint')}</p>
        ${d.mode === 'daily' ? html`<p class="door-hint">${t('doorDailyValid', { date: new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-IQ' : 'en-GB', { dateStyle: 'full' }).format(new Date(`${d.day}T12:00:00Z`)) })}</p>
          <button class="btn no-print" type="button" id="print">${ICON.print}${t('printPdf')}</button>`
        : html`<div class="door-timer" aria-hidden="true"><span></span></div>`}
        ${d.positionSet ? '' : html`<p class="banner">${t('doorNoPosition')}</p>`}
        <a class="btn ghost no-print" href="#/settings">${t('exitDoorScreen')}</a>
      </section>`);
      $('#print', view)?.addEventListener('click', () => window.print());
      // The bar empties as the code's minute runs out (styles can't be inline under the CSP).
      const bar = $('.door-timer span', view);
      if (bar) bar.style.setProperty('--d', `${Math.max(1, Math.round((Date.parse(d.validUntil) - Date.now()) / 1000))}s`);
      // Refresh just after the code changes (screen), or every few minutes (daily).
      const wait = d.mode === 'daily' ? 5 * 60000 : Math.max(2000, Date.parse(d.validUntil) - Date.now() + 800);
      doorTimer = setTimeout(draw, wait);
    };
    await draw();
  },
};

// Owner/manager helper used on the Settings screen.
export const canOpenDoor = () => can('attendance.manage');
