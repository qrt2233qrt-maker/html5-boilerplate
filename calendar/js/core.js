/* Core: helpers, dates, storage, the data model, recurrence and photos. Everything hangs off window.CC. */
window.CC = {};
(function (CC) {
  'use strict';
  const $ = CC.$ = (s, r) => (r || document).querySelector(s);
  const h = CC.h = function (tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style') for (const p in v) e.style.setProperty(p, v[p]);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(3)) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
  };
  /** Replace an element's children; arrays are flattened and empty values skipped. */
  CC.fill = (el, ...kids) => { el.replaceChildren(); for (const c of kids.flat(3)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); return el; };
  const ICONS = {
    cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    note: '<path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
    sliders: '<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    left: '<path d="M14 6l-6 6 6 6"/>', right: '<path d="M10 6l6 6-6 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    repeat: '<path d="M4 11a8 8 0 0 1 14-4l2 2M20 4v5h-5M20 13a8 8 0 0 1-14 4l-2-2M4 20v-5h5"/>',
    warn: '<path d="M12 4l9 16H3zM12 10v4M12 17v.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    planet: '<circle cx="12" cy="12" r="5"/><path d="M7.6 14.6C4.4 16.6 2.6 18.3 3.2 19.3c.9 1.5 6-.2 11.300-3.800S23.3 7.900 22.400 6.400c-.5-.9-2.500-.6-5.200.500"/>',
    chart: '<path d="M5 20V11M12 20V4M19 20v-7"/>'
  };
  CC.icon = (n) => { const s = document.createElement('span'); s.style.display = 'contents'; s.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + '</svg>'; return s; };
  CC.select = (id, opts, val, on) => { const s = h('select', { id, onchange: (e) => on && on(e.target.value) }, opts.map((o) => h('option', { value: String(o[0]), text: o[1] }))); s.value = String(val); return s; };

  // ---------- dates (all local "wall clock" times, so daylight saving shifts are handled by the browser) ----------
  const pad = CC.pad = (n) => String(n).padStart(2, '0');
  const ymd = CC.ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fromYmd = CC.fromYmd = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const addDays = CC.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  CC.shift = (s, n) => ymd(addDays(fromYmd(s), n));
  CC.today = () => ymd(new Date());
  CC.toMin = (t) => { const p = (t || '0:0').split(':').map(Number); return p[0] * 60 + p[1]; };
  CC.fromMin = (m) => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
  CC.dt = (date, time) => { const d = fromYmd(date), p = (time || '00:00').split(':').map(Number); d.setHours(p[0], p[1], 0, 0); return d; };
  CC.MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  CC.WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  CC.longDate = (s) => fromYmd(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  CC.shortDate = (s) => fromYmd(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  CC.fmtTime = (t) => { if (!t) return ''; if (CC.S.h24) return t; const p = t.split(':').map(Number); return (p[0] % 12 || 12) + ':' + pad(p[1]) + (p[0] < 12 ? ' AM' : ' PM'); };
  CC.fmtDur = (m) => m < 60 ? m + ' min' : (m % 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : (m / 60) + ' h');
  CC.weekStart = (s) => { const d = fromYmd(s); return ymd(addDays(d, -((d.getDay() - CC.S.weekStart + 7) % 7))); };
  const uid = CC.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- storage ----------
  function load(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }
  const DEF = {
    name: 'My Calendar', density: 'cozy', motion: 'auto', weekStart: 0, h24: false, monthPhotos: {}, dayPhotos: {}, calView: 'week',
    bg: { exp: 'luxe', dim: 18 }, doneMsg: 'Well done, My baby ❤️',
    sound: 'chime', vol: 70, quiet: { on: false, from: '22:00', to: '07:00' }, allDayAt: '09:00',
    defRems: [], defNag: 0, dayFrom: 8, dayTo: 22, pomo: { work: 25, brk: 5, long: 15 }, pomoLog: {}
  };
  const S = CC.S = Object.assign({}, DEF, load('cc.settings', {}));
  S.bg = { exp: S.bg && S.bg.exp === 'cosmic' ? 'cosmic' : 'luxe', dim: S.bg && S.bg.exp ? S.bg.dim : DEF.bg.dim };
  S.quiet = Object.assign({}, DEF.quiet, S.quiet); S.pomo = Object.assign({}, DEF.pomo, S.pomo);
  for (const k of ['look', 'accent', 'font', 'hidden']) delete S[k]; // the old theme system is gone
  CC.saveS = () => store('cc.settings', S);
  CC.alerts = load('cc.alerts', {});
  CC.saveAlerts = () => store('cc.alerts', CC.alerts);

  CC.KINDS = { appt: 'Appointment', task: 'Task', rem: 'Reminder' };
  CC.PRIO = { high: 'High', med: 'Normal', low: 'Low' };
  CC.blank = () => ({ id: uid(), kind: 'appt', title: '', date: CC.today(), time: '', dur: 60, notes: '', cat: '', prio: 'med', status: 'active', archived: false, rems: [], nag: 0, nagFrom: 'start', rr: null, ex: [], over: {}, created: Date.now(), updated: Date.now() });
  CC.blankNote = () => ({ id: uid(), title: '', body: '', cat: '', color: '', labels: [], checklist: [], files: [], date: '', linked: '', pinned: false, archived: false, deleted: 0, created: Date.now(), updated: Date.now() });

  let D = load('cc.data', null);
  if (!D) {
    D = { v: 2, items: [], notes: [], cats: [{ id: 'pers', name: 'Personal', color: '#f08fb8' }, { id: 'school', name: 'School', color: '#a99bf5' }, { id: 'health', name: 'Health', color: '#5fcfa8' }, { id: 'work', name: 'Work', color: '#6fb6f5' }, { id: 'fam', name: 'Family', color: '#f5b072' }] };
    const old = load('cc.items', null);
    if (old) { // bring over what was saved by the first version of this calendar
      for (const o of old) {
        if (o.type === 'note') D.notes.push(Object.assign(CC.blankNote(), { title: o.title, body: o.notes || '', date: o.date, example: !!o.example }));
        else D.items.push(Object.assign(CC.blank(), { kind: o.type === 'task' ? 'task' : o.type === 'rem' ? 'rem' : 'appt', title: o.title, date: o.date, time: o.time || '', notes: o.notes || '', rems: (o.reminders || []).map((m) => ({ m })), status: o.done ? 'done' : 'active', example: !!o.example }));
      }
    } else {
      const d = (n) => ymd(addDays(new Date(), n)), E = (o) => Object.assign(CC.blank(), { example: true }, o);
      D.items = [
        E({ kind: 'rem', title: 'Call grandma', date: d(0), time: '18:00', rems: [{ m: 10 }], cat: 'fam' }),
        E({ kind: 'appt', title: 'Dentist check-up', date: d(2), time: '15:30', dur: 45, rems: [{ m: 1440 }, { m: 60 }, { m: 0 }], nag: 10, cat: 'health', prio: 'high' }),
        E({ kind: 'appt', title: 'Coffee with Sam', date: d(2), time: '15:00', dur: 60, cat: 'pers' }),
        E({ kind: 'appt', title: 'Study group', date: d(1), time: '16:00', dur: 90, cat: 'school', rr: { f: 'w', n: 1, days: [], until: '', count: 0 } }),
        E({ kind: 'task', title: 'History essay draft', date: d(4), rems: [{ m: 4320 }, { m: 1440 }], cat: 'school', prio: 'high' }),
        E({ kind: 'task', title: 'Math problem set', date: d(-1), cat: 'school' }),
        E({ kind: 'task', title: 'Read chapter 3', date: d(-2), status: 'done', doneAt: Date.now() - 864e5, cat: 'school', prio: 'low' })
      ];
      D.notes = [Object.assign(CC.blankNote(), { title: 'Weekend ideas', body: 'Picnic if it is sunny, baking if it rains.', date: d(0), cat: 'pers', color: '#f08fb8', checklist: [{ t: 'Buy strawberries', done: false }, { t: 'Charge the camera', done: true }], example: true })];
    }
  }
  CC.D = D;
  CC.save = () => { if (!store('cc.data', D)) CC.toast && CC.toast('Could not save. This browser is blocking storage.'); };
  CC.cat = (id) => D.cats.find((c) => c.id === id);
  CC.colorOf = (it) => { const c = CC.cat(it.cat); return c ? c.color : ''; };

  // ---------- recurrence ----------
  function expand(it, from, to) {
    const r = it.rr;
    if (!r) return it.date >= from && it.date <= to ? [it.date] : [];
    const out = [], n = Math.max(1, r.n || 1), until = r.until || '9999-12-31', base = fromYmd(it.date), ex = it.ex || [];
    const last = to < until ? to : until; let count = 0;
    const take = (s) => { count++; if (s >= from && !ex.includes(s)) out.push(s); };
    if (r.f === 'w' && r.days && r.days.length) {
      const w0 = addDays(base, -base.getDay());
      for (let i = 0, d = new Date(base); i < 4000; i++, d = addDays(d, 1)) {
        const s = ymd(d); if (s > last || (r.count && count >= r.count)) break;
        if (r.days.includes(d.getDay()) && Math.floor(Math.round((d - w0) / 864e5) / 7) % n === 0) take(s);
      }
      return out;
    }
    for (let k = 0; k < 4000; k++) {
      let d;
      if (r.f === 'd') d = addDays(base, k * n);
      else if (r.f === 'w') d = addDays(base, 7 * k * n);
      else if (r.f === 'm') { d = new Date(base.getFullYear(), base.getMonth() + k * n, base.getDate()); if (d.getDate() !== base.getDate()) continue; }
      else { d = new Date(base.getFullYear() + k * n, base.getMonth(), base.getDate()); if (d.getMonth() !== base.getMonth()) continue; }
      const s = ymd(d); if (s > last || (r.count && count >= r.count)) break;
      take(s);
    }
    return out;
  }
  const mkOcc = (it, date) => { const ov = it.rr ? (it.over || {})[date] : null; return { it, date, key: it.id + '@' + date, st: it.status === 'canceled' ? 'canceled' : it.rr ? (ov ? ov.st : 'active') : it.status, time: it.time, dur: it.dur || 60 }; };
  /** Every occurrence between two dates (inclusive), repeats expanded. */
  CC.occs = (from, to) => { const out = []; for (const it of D.items) for (const d of expand(it, from, to)) out.push(mkOcc(it, d)); return out; };
  CC.visible = (from, to) => CC.occs(from, to).filter((o) => o.st !== 'canceled' && !o.it.archived);
  CC.find = (key) => { const p = key.split('@'), it = D.items.find((i) => i.id === p[0]); return it ? mkOcc(it, p[1]) : null; };
  CC.byTime = (a, b) => (a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : 0;
  CC.startOf = (o) => CC.dt(o.date, o.time || S.allDayAt);
  CC.isOverdue = (o) => o.st === 'active' && (o.it.kind === 'task' || !o.time ? o.date < CC.today() : CC.dt(o.date, o.time).getTime() + (o.it.kind === 'appt' ? o.dur * 6e4 : 0) < Date.now());

  CC.setStatus = (o, st) => {
    const it = o.it;
    if (it.rr && st !== 'canceledAll') { it.over = it.over || {}; if (st === 'active') delete it.over[o.date]; else it.over[o.date] = { st, at: Date.now() }; }
    else { it.status = st === 'canceledAll' ? 'canceled' : st; it.doneAt = st === 'done' ? Date.now() : 0; }
    it.updated = Date.now(); delete CC.alerts[o.key]; CC.saveAlerts(); CC.save();
  };
  /** Turn one occurrence of a repeating item into its own item, so it can change without touching the rest. */
  CC.detach = (o) => {
    if (!o.it.rr) return o.it;
    const c = Object.assign({}, o.it, { id: uid(), rr: null, ex: [], over: {}, date: o.date, status: o.st, created: Date.now() });
    o.it.ex = (o.it.ex || []).concat(o.date); D.items.push(c); return c;
  };
  CC.move = (o, date, time, dur) => {
    const it = CC.detach(o); it.date = date; if (time != null) it.time = time; if (dur) it.dur = dur;
    it.moved = (it.moved || 0) + 1; it.updated = Date.now(); delete CC.alerts[o.key]; CC.saveAlerts(); CC.save(); return it;
  };

  // ---------- scheduling help ----------
  const timed = (date) => CC.visible(date, date).filter((o) => o.time && o.it.kind === 'appt' && o.st === 'active').sort(CC.byTime);
  CC.conflicts = (date, skipId) => {
    const l = timed(date).filter((o) => o.it.id !== skipId), out = [];
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (CC.toMin(l[j].time) < CC.toMin(l[i].time) + l[i].dur) out.push([l[i], l[j]]);
    return out;
  };
  CC.clashWith = (date, time, dur, skipId) => !time ? [] : timed(date).filter((o) => o.it.id !== skipId && CC.toMin(o.time) < CC.toMin(time) + dur && CC.toMin(time) < CC.toMin(o.time) + o.dur);
  CC.freeSlots = (date, skipId) => {
    const a = S.dayFrom * 60, b = S.dayTo * 60, out = []; let cur = a;
    if (date === CC.today()) { const n = new Date(); cur = Math.max(a, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15); }
    for (const o of timed(date)) { if (o.it.id === skipId) continue; const s = CC.toMin(o.time), e = s + o.dur; if (s - cur >= 30) out.push([cur, Math.min(s, b)]); cur = Math.max(cur, e); if (cur >= b) break; }
    if (b - cur >= 30) out.push([cur, b]);
    return out.filter((x) => x[1] > x[0]);
  };
  CC.stats = () => {
    const t = CC.today(), days = [];
    for (let i = 6; i >= 0; i--) { const d = CC.shift(t, -i), l = CC.visible(d, d); days.push({ d, total: l.length, done: l.filter((o) => o.st === 'done').length }); }
    const ws = CC.weekStart(t), wk = CC.visible(ws, CC.shift(ws, 6)), done = wk.filter((o) => o.st === 'done').length;
    return { days, total: wk.length, done, pct: wk.length ? Math.round(done / wk.length * 100) : 0 };
  };

  // ---------- photos and attached files ----------
  const idb = CC.idb = {
    db: null,
    open() { return new Promise((res) => { try { const rq = indexedDB.open('cozy-calendar', 2); rq.onupgradeneeded = () => { for (const n of ['photos', 'files']) if (!rq.result.objectStoreNames.contains(n)) rq.result.createObjectStore(n, { keyPath: 'id' }); }; rq.onsuccess = () => { idb.db = rq.result; res(); }; rq.onerror = () => res(); } catch (e) { res(); } }); },
    run(st, mode, fn) { return new Promise((res) => { if (!idb.db) return res(null); try { const tx = idb.db.transaction(st, mode), rq = fn(tx.objectStore(st)); tx.oncomplete = () => res(rq ? rq.result : null); tx.onerror = tx.onabort = () => res(null); } catch (e) { res(null); } }); },
    all: (st) => idb.run(st, 'readonly', (s) => s.getAll()), get: (st, id) => idb.run(st, 'readonly', (s) => s.get(id)),
    put: (st, rec) => idb.run(st, 'readwrite', (s) => s.put(rec)), del: (st, id) => idb.run(st, 'readwrite', (s) => s.delete(id))
  };
  CC.uploads = [];
  CC.pool = () => CC.uploads.map((u) => u.id);
  CC.srcOf = (id) => { const u = CC.uploads.find((p) => p.id === id); return u ? u.url : ''; };
  CC.hasPhoto = (id) => !!id && CC.uploads.some((p) => p.id === id);
  CC.randomPhoto = (not) => { const p = CC.pool(); if (!p.length) return null; const q = p.length > 1 ? p.filter((id) => id !== not) : p; return q[Math.floor(Math.random() * q.length)]; };
  CC.monthPhoto = (key) => { if (CC.hasPhoto(S.monthPhotos[key])) return S.monthPhotos[key]; const p = CC.pool(); if (!p.length) return null; let n = 0; for (const ch of key) n = (n * 31 + ch.charCodeAt(0)) % 9973; return p[n % p.length]; };
  CC.shrink = (file, max) => new Promise((res) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, (max || 1600) / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob((b) => res(b || file), 'image/jpeg', 0.85); };
    img.onerror = () => { URL.revokeObjectURL(u); res(null); }; img.src = u;
  });
  CC.addPhotos = async (files) => {
    let n = 0, last = null;
    for (const f of files) { if (!f.type.startsWith('image/')) continue; const blob = await CC.shrink(f); if (!blob) continue; const id = 'u-' + uid(); await idb.put('photos', { id, blob }); CC.uploads.push({ id, url: URL.createObjectURL(blob) }); n++; last = id; }
    CC.toast(n ? (n === 1 ? 'Photo added' : n + ' photos added') : 'That file is not a picture this calendar can read');
    return last;
  };
  let pickDone = null;
  CC.pickFiles = (accept, done) => { pickDone = done; const i = $('#file-in'); i.accept = accept; i.value = ''; i.click(); };
  document.addEventListener('DOMContentLoaded', () => { const i = $('#file-in'); if (i) i.addEventListener('change', (e) => { const fn = pickDone; pickDone = null; if (fn) fn(Array.from(e.target.files || [])); }); });
})(window.CC);
