// Clocking in and out at the restaurant: the phone's position plus the code
// shown at the door. Also the door screen managers keep on a tablet.
import { api } from './api.js';
import { LANG, t } from './i18n.js';
import { ICON } from './icons.js';
import { S, bpath, can } from './state.js';
import { time } from './fmt.js';
import { errorMessage, openSheet, closeSheet } from './ui.js';
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

// Clock in (or out) at work: with the code from the door QR (plus the
// position when the business checks it), or by position alone (gps).
export async function zoneClock({ out = false, locationId, code, breakMinutes = 0, checkLocation = true, gps = false }) {
  const where = gps ? await position() : { locationId, code, ...(checkLocation ? await position() : {}) };
  return out
    ? api.post(bpath('/attendance/clock-out'), { breakMinutes, ...where })
    : api.post(bpath('/attendance/clock-in'), where);
}

// Friendly text for location problems as well as the server's refusals.
export function clockError(err) {
  if (err?.code?.startsWith?.('geo_') || err?.code?.startsWith?.('cam_')) return t(`e.${err.code}`);
  if (err?.code === 'outside_zone' && err.details) return t('e.outside_zone_far', { m: err.details.distance, place: err.details.location, r: err.details.radius });
  return errorMessage(err);
}

// The location id and code inside a door QR (a link to #/clock?l=…&c=…).
export function readDoorQr(text) {
  try {
    const u = new URL(text);
    const q = new URLSearchParams(u.hash.split('?')[1] || '');
    if (!u.hash.startsWith('#/clock') || !q.get('l') || !q.get('c')) return null;
    return { locationId: q.get('l'), code: q.get('c') };
  } catch { return null; }
}

// ---------- camera scanner ----------

let jsqrLoading = null;
function loadJsQr() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsqrLoading ||= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = '/vendor/jsQR.js';
    sc.onload = () => resolve(window.jsQR);
    sc.onerror = () => { jsqrLoading = null; reject(new Error('decoder')); };
    document.head.append(sc);
  });
  return jsqrLoading;
}

// Starts the back camera in `video` and calls onCode(text) for each QR seen.
// Returns stop().
async function startScanner(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera'), { code: 'cam_unavailable' });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    throw Object.assign(new Error(e.message), { code: e.name === 'NotAllowedError' ? 'cam_denied' : 'cam_unavailable' });
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {});
  let stopped = false;
  const stop = () => { stopped = true; stream.getTracks().forEach((tr) => tr.stop()); };
  let detect;
  if ('BarcodeDetector' in window) {
    try {
      const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
      detect = async () => (await bd.detect(video))[0]?.rawValue || null;
    } catch { detect = null; }
  }
  if (!detect) {
    const jsQR = await loadJsQr();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    detect = async () => {
      const w = video.videoWidth; const h = video.videoHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, 640 / Math.max(w, h));
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })?.data || null;
    };
  }
  const tick = async () => {
    if (stopped || !video.isConnected) { if (!stopped) stop(); return; }
    try {
      const text = video.readyState >= 2 ? await detect() : null;
      if (text && onCode(text) === true) return;
    } catch { /* keep looking */ }
    setTimeout(tick, 180);
  };
  tick();
  return stop;
}

// A short celebration when someone clocks in or out.
export function celebrate(host, { out, at }) {
  mount(host, html`<div class="clock-done ${out ? 'out' : 'in'}" role="status">
    <div class="burst" aria-hidden="true">${[...Array(12)].map((_, i) => html`<i class="b${i}"></i>`)}</div>
    <span class="big-tick">${ICON.check}</span>
    <h2>${out ? t('clockedOut') : t('clockedIn')}</h2>
    <p class="num">${time(at)} · ${S.business.name}</p>
    <p class="muted">${out ? t('byeMessage') : t('helloMessage', { name: S.me.user.name.split(' ')[0] })}</p></div>`);
  navigator.vibrate?.(out ? [30, 60, 30] : 40);
}

// The sheet behind the Clock in / Clock out buttons when being at work has
// to be proven: scan the QR at the door, or (gps / either) use the phone's
// position near the restaurant.
export async function zoneSheet({ out, onDone, clock }) {
  const cfg = clock || (await api.get(bpath('/me/week'))).clock || { method: 'qr', checkLocation: true, typedCode: false };
  const method = cfg.method || 'qr';
  const scan = method !== 'gps';
  const sheet = openSheet({
    title: out ? t('clockOut') : t('clockIn'),
    body: html`${out ? html`<div class="field"><label class="label" for="z-brk">${t('breakMinutes')}</label>
        <input class="input" id="z-brk" type="number" min="0" max="600" value="0" inputmode="numeric"></div>` : ''}
      ${scan ? html`<div class="scanner" id="scanner"><video id="z-video" aria-label="${t('cameraView')}"></video><span class="scan-frame" aria-hidden="true"><i></i></span>
        <p class="scan-msg" id="z-msg" role="status">${t('pointAtQr')}</p></div>`
        : html`<div class="gps-state" id="z-gps" role="status"><span class="gps-pin" aria-hidden="true">${ICON.pin}</span><p id="z-msg">${t('gpsClockHint')}</p></div>`}
      <div class="form-error" role="alert" id="z-err"></div>
      ${method !== 'qr' ? html`<button class="btn ${scan ? '' : 'primary'} block" type="button" id="z-gps-go">${ICON.pin}${scan ? t('useMyLocation') : (out ? t('clockOutHere') : t('clockInHere'))}</button>` : ''}
      ${scan && cfg.typedCode ? html`<form id="zone-form" novalidate class="typed-code"><label class="label" for="z-code">${t('orTypeCode')}</label>
        <div class="row-gap"><input class="input code-input" id="z-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" dir="ltr" placeholder="••••••">
        <button class="btn" type="submit">${t('continue')}</button></div></form>` : ''}
      <p class="hint">${method === 'qr' ? (cfg.checkLocation ? t('locationPrivacy') : t('scanOnlyHint')) : method === 'gps' ? t('locationPrivacy') : t('eitherHint')}</p>`,
  });
  const err = $('#z-err', sheet);
  const msg = $('#z-msg', sheet);
  const box = $('#scanner', sheet) || $('#z-gps', sheet);
  let busyNow = false;
  let stop = () => {};
  const go = async ({ locationId, code, gps = false }) => {
    if (busyNow) return;
    busyNow = true;
    err.textContent = '';
    const idle = msg.textContent;
    msg.textContent = gps || cfg.checkLocation ? t('findingLocation') : t('checking');
    box.classList.add('got');
    try {
      const r = await zoneClock({ out, locationId, code, gps, checkLocation: cfg.checkLocation, breakMinutes: Number($('#z-brk', sheet)?.value || 0) });
      stop();
      celebrate($('.sbody', sheet) || sheet, { out, at: out ? r.clockOut : r.clockIn });
      setTimeout(() => { closeSheet(); onDone?.(); }, 1900);
    } catch (e) {
      busyNow = false;
      box.classList.remove('got');
      msg.textContent = idle;
      err.textContent = clockError(e);
    }
  };
  $('#z-gps-go', sheet)?.addEventListener('click', () => go({ gps: true }));
  $('#zone-form', sheet)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const locs = (await api.get(bpath('/locations'))).filter((l) => !l.archivedAt && l.latitude !== null);
    go({ locationId: locs[0]?.id, code: $('#z-code', sheet).value });
  });
  if (!scan) return;
  try {
    stop = await startScanner($('#z-video', sheet), (text) => {
      const qr = readDoorQr(text);
      if (!qr) { msg.textContent = t('notDoorQr'); return false; }
      go(qr);
      return false;
    });
  } catch (e) {
    $('#scanner', sheet).classList.add('off');
    msg.textContent = '';
    // With GPS allowed, a camera problem isn't a dead end.
    err.textContent = method === 'either' ? `${clockError(e)} ${t('orUseLocation')}` : clockError(e);
  }
  // Stop the camera when the sheet closes.
  const video = $('#z-video', sheet);
  const watch = setInterval(() => { if (!video.isConnected || !sheet.open) { stop(); clearInterval(watch); } }, 400);
}

// Opened by scanning the door QR: clocks in straight away, or offers clock-out.
export const clockPage = {
  title: () => t('clockIn'),
  async render(view, { query }) {
    const locationId = query.get('l');
    const code = query.get('c');
    const week = await api.get(bpath('/me/week'));
    const out = !!week.clockedIn;
    const checkLocation = week.clock?.checkLocation !== false;
    const card = (body) => mount(view, html`<section class="panel clock-scan">${body}</section>`);
    const run = async (breakMinutes = 0) => {
      card(html`<div class="scan-state"><span class="spinner" aria-hidden="true"></span><p>${checkLocation ? t('findingLocation') : t('checking')}</p></div>`);
      try {
        const r = await zoneClock({ out, locationId, code, breakMinutes, checkLocation });
        card(html`<div id="done"></div><a class="btn primary block" href="#/home">${t('home')}</a>`);
        celebrate($('#done', view), { out, at: out ? r.clockOut : r.clockIn });
      } catch (err) {
        card(html`<div class="scan-state bad"><span class="big-x" aria-hidden="true">!</span>
          <h2>${out ? t('couldNotClockOut') : t('couldNotClockIn')}</h2><p>${clockError(err)}</p>
          ${err.code === 'invalid_door_code' ? html`<p class="hint">${t('scanAgainHint')}</p>` : html`<button class="btn primary" type="button" id="again">${t('tryAgain')}</button>`}
          ${checkLocation ? html`<p class="hint">${t('locationPrivacy')}</p>` : ''}</div>`);
        // Clocking out goes back to the break field, so it can be corrected.
        $('#again', view)?.addEventListener('click', () => (out ? ask(breakMinutes) : run()));
      }
    };
    if (!out) return run();
    const ask = (brk = 0) => {
      card(html`<h2>${t('clockOut')}</h2><p class="muted">${t('clockedInSince', { time: time(week.clockedIn.since) })}</p>
        <div class="field"><label class="label" for="brk2">${t('breakMinutes')}</label>
          <input class="input" id="brk2" type="number" min="0" max="600" value="${brk}" inputmode="numeric"></div>
        <button class="btn primary block" type="button" id="go">${t('clockOut')}</button>`);
      $('#go', view).onclick = () => run(Number($('#brk2', view).value || 0));
    };
    ask();
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
