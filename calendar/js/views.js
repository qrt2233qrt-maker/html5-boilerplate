/* Calendar views: month, week, day, year, agenda and tasks. */
(function (CC) {
  'use strict';
  const { $, h, S, ui, R } = CC;
  const cstyle = (it) => { const c = CC.colorOf(it); return c ? { '--c': c } : null; };
  const PR = { high: 0, med: 1, low: 2 };
  const group = (list) => { const m = {}; for (const o of list) (m[o.date] = m[o.date] || []).push(o); for (const k in m) m[k].sort(CC.byTime); return m; };

  CC.toggleDone = (o, e) => { if (o.st === 'done') CC.setStatus(o, 'active'); else { CC.setStatus(o, 'done'); if (e) CC.sparks(e.clientX, e.clientY); } R.tick(); CC.render(); };
  CC.removeItem = async (o) => {
    if (!(await CC.confirm(o.it.rr ? 'Delete "' + o.it.title + '" and all of its repeats for good?' : 'Delete "' + o.it.title + '" for good?', 'Delete', true))) return false;
    CC.D.items = CC.D.items.filter((i) => i.id !== o.it.id); CC.save(); CC.toast('Deleted'); R.tick(); CC.render(); return true;
  };
  CC.itemMenu = (o, x, y) => CC.menu(x, y, [
    o.st !== 'canceled' && { label: o.st === 'done' ? 'Mark not done' : '✓ Mark done', fn: () => CC.toggleDone(o) },
    { label: 'Edit', fn: () => CC.openEditor(o) },
    { label: 'Duplicate', fn: () => { CC.D.items.push(Object.assign({}, o.it, { id: CC.uid(), rr: null, ex: [], over: {}, date: o.date, status: 'active', example: false, created: Date.now() })); CC.save(); CC.toast('Duplicated'); CC.render(); } },
    o.st === 'active' && { label: 'Move to tomorrow', fn: () => R.postpone(o, CC.shift(o.date < CC.today() ? CC.today() : o.date, 1), o.time) },
    o.st === 'active' && { label: 'Mark as missed', fn: () => { CC.setStatus(o, 'missed'); R.tick(); CC.render(); } },
    o.it.rr && { label: 'Skip just this one', fn: () => { o.it.ex = (o.it.ex || []).concat(o.date); CC.save(); CC.render(); } },
    o.st !== 'canceled' ? { label: 'Cancel it', danger: true, fn: () => { CC.setStatus(o, 'canceled'); CC.toast('Canceled. Find it under Agenda, Canceled.'); R.tick(); CC.render(); } } : { label: 'Restore', fn: () => { CC.setStatus(o, 'active'); o.it.status = o.it.status === 'canceled' ? 'active' : o.it.status; CC.save(); CC.render(); } },
    { label: 'Delete for good', danger: true, fn: () => CC.removeItem(o) }]);

  CC.itemRow = (o, showDate) => {
    const it = o.it, meta = [], c = CC.cat(it.cat);
    if (showDate) meta.push(h('span', { text: CC.shortDate(o.date) }));
    if (o.time) meta.push(h('span', { text: CC.fmtTime(o.time) + (it.kind === 'appt' ? ' · ' + CC.fmtDur(o.dur) : '') }));
    if (CC.isOverdue(o)) meta.push(h('span', { class: 'late', text: it.kind === 'task' ? 'Overdue' : 'Not ticked off yet' }));
    if (o.st === 'missed') meta.push(h('span', { class: 'late', text: 'Missed' }));
    if (o.st === 'canceled') meta.push(h('span', { text: 'Canceled' }));
    if (it.archived) meta.push(h('span', { text: 'Archived' }));
    if (it.moved) meta.push(h('span', { text: 'Rescheduled' }));
    if (it.prio === 'high') meta.push(h('span', { class: 'prio-high', text: 'High priority' }));
    if (it.rr) meta.push(h('span', {}, CC.icon('repeat'), ' Repeats'));
    if ((it.rems || []).length || it.nag) meta.push(h('span', {}, CC.icon('bell'), ' ' + ((it.rems || []).length || '') + (it.nag ? ' until done' : '')));
    if (c) meta.push(h('span', { text: c.name }));
    return h('li', { class: 'item ' + o.st, style: cstyle(it), oncontextmenu: (e) => { e.preventDefault(); CC.itemMenu(o, e.clientX, e.clientY); } },
      o.st !== 'canceled' && h('button', { class: 'check', type: 'button', 'aria-pressed': String(o.st === 'done'), 'aria-label': (o.st === 'done' ? 'Mark not done: ' : 'Mark done: ') + it.title, onclick: (e) => CC.toggleDone(o, e) }, o.st === 'done' ? '✓' : ''),
      h('button', { class: 'item-main', type: 'button', onclick: () => CC.openEditor(o) },
        h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'tag', text: CC.KINDS[it.kind] }), it.example && h('span', { class: 'eg', text: 'Example' })),
        h('span', { class: 'item-title', text: it.title }), meta.length ? h('span', { class: 'item-meta' }, meta) : null,
        it.notes ? h('span', { class: 'item-meta', text: it.notes.length > 120 ? it.notes.slice(0, 120) + '…' : it.notes }) : null),
      h('button', { class: 'ib', type: 'button', style: { width: '30px', height: '30px', border: '0', background: 'transparent' }, 'aria-label': 'More actions for ' + it.title, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); CC.itemMenu(o, r.left - 150, r.bottom); } }, '⋯'));
  };
  const list = (occs, showDate, empty) => occs.length ? h('ul', { class: 'items' }, occs.map((o) => CC.itemRow(o, showDate))) : h('div', { class: 'empty', text: empty });

  // ---------- toolbar ----------
  function step(n) {
    const d = CC.fromYmd(ui.sel), v = S.calView;
    if (v === 'day') ui.sel = CC.shift(ui.sel, n); else if (v === 'week') ui.sel = CC.shift(ui.sel, 7 * n);
    else { const y = d.getFullYear() + (v === 'year' ? n : 0), m = d.getMonth() + (v === 'month' ? n : 0), last = new Date(y, m + 1, 0).getDate(); ui.sel = CC.ymd(new Date(y, m, Math.min(d.getDate(), last))); }
    ui.dir = n > 0 ? 'flip-n' : 'flip-p'; ui.dayShown = null; CC.render();
  }
  CC.step = step;
  CC.setCal = (v) => { S.calView = v; CC.saveS(); ui.view = 'cal'; ui.dir = 'fade-in'; CC.render(); };
  function tools(title) {
    return h('div', { class: 'tools glass' },
      h('div', { class: 'row' }, h('button', { class: 'ib', type: 'button', 'aria-label': 'Previous', onclick: () => step(-1) }, CC.icon('left')),
        h('button', { class: 'btn small', type: 'button', onclick: () => { ui.sel = CC.today(); ui.dayShown = null; ui.dir = 'fade-in'; CC.render(); } }, 'Today'),
        h('button', { class: 'ib', type: 'button', 'aria-label': 'Next', onclick: () => step(1) }, CC.icon('right')), h('h2', { text: title })),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Calendar view' }, [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']].map((v) => h('button', { type: 'button', 'aria-pressed': String(S.calView === v[0]), onclick: () => CC.setCal(v[0]) }, v[1]))));
  }

  // ---------- day panel ----------
  CC.dayPanel = (date) => {
    if (!CC.hasPhoto(ui.dayShown)) ui.dayShown = CC.hasPhoto(S.dayPhotos[date]) ? S.dayPhotos[date] : CC.randomPhoto(null);
    const pinned = S.dayPhotos[date] === ui.dayShown, occs = CC.visible(date, date).sort(CC.byTime), notes = CC.D.notes.filter((n) => n.date === date && !n.deleted && !n.archived);
    const free = CC.freeSlots(date), freeMin = free.reduce((a, s) => a + s[1] - s[0], 0), clashes = CC.conflicts(date);
    const fix = (pair) => { const o = pair[1], slot = CC.freeSlots(date, o.it.id).find((s) => s[1] - s[0] >= o.dur && s[0] !== CC.toMin(o.time)); return slot && h('button', { class: 'btn small', type: 'button', onclick: () => { CC.move(o, date, CC.fromMin(slot[0])); CC.toast('Moved to ' + CC.fmtTime(CC.fromMin(slot[0]))); CC.render(); } }, 'Move "' + o.it.title + '" to ' + CC.fmtTime(CC.fromMin(slot[0]))); };
    return h('aside', { class: 'glass card', 'aria-label': 'Chosen day' },
      h('div', { class: 'row between' }, h('h2', { text: CC.longDate(date) }), S.calView !== 'day' && h('button', { class: 'btn small', type: 'button', onclick: () => CC.setCal('day') }, 'Open day')),
      h('div', { class: 'day-photo' }, h('img', { src: CC.srcOf(ui.dayShown), alt: '' }),
        h('div', { class: 'on-photo-row' },
          h('button', { class: 'on-photo', type: 'button', onclick: () => { delete S.dayPhotos[date]; CC.saveS(); ui.dayShown = CC.randomPhoto(ui.dayShown); CC.render(); } }, 'Shuffle'),
          h('button', { class: 'on-photo', type: 'button', 'aria-pressed': String(pinned), onclick: () => { if (pinned) delete S.dayPhotos[date]; else S.dayPhotos[date] = ui.dayShown; CC.saveS(); CC.render(); CC.toast(pinned ? 'This day is random again' : 'Photo kept for this day'); } }, pinned ? 'Kept ✓' : 'Keep'),
          h('button', { class: 'on-photo', type: 'button', onclick: () => CC.openPicker('Photo for ' + CC.shortDate(date), (id) => { S.dayPhotos[date] = id; ui.dayShown = id; CC.saveS(); CC.render(); }) }, 'Choose'))),
      clashes.map((p) => h('div', { class: 'banner' }, CC.icon('warn'), h('div', { class: 'col', style: { gap: '6px' } }, h('span', { text: '"' + p[0].it.title + '" and "' + p[1].it.title + '" overlap.' }), fix(p)))),
      list(occs, false, 'Nothing on this day yet.'),
      notes.map((n) => h('button', { class: 'note-inline', type: 'button', style: n.color ? { '--c': n.color } : null, onclick: () => CC.openNote(n) }, h('span', { class: 'tag', text: 'Note' }), h('div', { class: 'item-title', text: n.title || 'Untitled note' }), n.body && h('div', { class: 'item-meta', text: n.body.slice(0, 140) }))),
      date >= CC.today() && h('p', { class: 'hint', text: freeMin ? 'Free: ' + CC.fmtDur(freeMin) + ' between ' + S.dayFrom + ':00 and ' + S.dayTo + ':00. Longest gap starts ' + CC.fmtTime(CC.fromMin(free.slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0][0])) + '.' : 'No free gaps left in your day hours.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => CC.openEditor(null, { date }) }, CC.icon('plus'), 'Add'),
        h('button', { class: 'btn', type: 'button', onclick: () => CC.openNote(null, { date }) }, 'Add note')));
  };

  // ---------- month ----------
  function monthView() {
    const a = CC.fromYmd(ui.sel), y = a.getFullYear(), m = a.getMonth(), key = y + '-' + CC.pad(m + 1), today = CC.today();
    const count = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() - S.weekStart + 7) % 7, by = group(CC.visible(key + '-01', key + '-' + CC.pad(count)));
    const hero = h('div', { class: 'hero tilt', onpointermove: (e) => { if (e.pointerType !== 'mouse' || CC.motion() !== 'full') return; const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty('--ry', ((e.clientX - r.left) / r.width - .5) * 7 + 'deg'); e.currentTarget.style.setProperty('--rx', (.5 - (e.clientY - r.top) / r.height) * 7 + 'deg'); }, onpointerleave: (e) => { e.currentTarget.style.setProperty('--rx', '0deg'); e.currentTarget.style.setProperty('--ry', '0deg'); } },
      h('img', { src: CC.srcOf(CC.monthPhoto(key)), alt: '' }), h('div', { class: 'scrim' }),
      h('div', { class: 'hero-text' }, h('span', { text: String(y) }), h('h2', { text: CC.MONTHS[m] })),
      h('div', { class: 'on-photo-row' },
        h('button', { class: 'on-photo', type: 'button', onclick: () => { S.monthPhotos[key] = CC.randomPhoto(CC.monthPhoto(key)); CC.saveS(); CC.render(); } }, 'Shuffle'),
        h('button', { class: 'on-photo', type: 'button', onclick: () => CC.openPicker('Photo for ' + CC.MONTHS[m], (id) => { S.monthPhotos[key] = id; CC.saveS(); CC.render(); }) }, 'Choose')));
    const grid = h('div', { class: 'mgrid glass ' + ui.dir });
    for (let i = 0; i < 7; i++) grid.append(h('div', { class: 'wd', text: CC.WD[(i + S.weekStart) % 7] }));
    for (let i = 0; i < lead; i++) grid.append(h('div', {}));
    for (let d = 1; d <= count; d++) {
      const ds = key + '-' + CC.pad(d), l = by[ds] || [];
      grid.append(h('button', {
        class: 'cell' + (ds === today ? ' today' : '') + (ds === ui.sel ? ' sel' : ''), type: 'button', 'data-date': ds, 'aria-pressed': String(ds === ui.sel),
        'aria-label': CC.longDate(ds) + (l.length ? ', ' + l.length + (l.length === 1 ? ' item' : ' items') : ''),
        onclick: () => { ui.sel = ds; ui.dayShown = null; ui.dir = ''; CC.render(); }, ondblclick: () => CC.openEditor(null, { date: ds }),
        ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave: (e) => e.currentTarget.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); const o = CC.find(e.dataTransfer.getData('text/plain')); if (o && o.date !== ds) { CC.move(o, ds); CC.toast('Moved to ' + CC.shortDate(ds)); R.tick(); } CC.render(); }
      }, h('span', { class: 'n', text: String(d) }),
        h('span', { class: 'dots' }, l.slice(0, 4).map((o) => h('span', { class: 'dot', style: cstyle(o.it) }))),
        h('span', { class: 'evs' }, l.slice(0, 3).map((o) => h('span', { class: 'mchip ' + o.st, style: cstyle(o.it), draggable: 'true', ondragstart: (e) => { e.dataTransfer.setData('text/plain', o.key); e.dataTransfer.effectAllowed = 'move'; }, text: (o.time ? CC.fmtTime(o.time).replace(':00', '').replace(' ', '').toLowerCase() + ' ' : '') + o.it.title })), l.length > 3 && h('span', { class: 'more', text: '+' + (l.length - 3) + ' more' }))));
    }
    return [tools(CC.MONTHS[m] + ' ' + y), h('div', { class: 'cal-layout split' }, h('div', { class: 'col' }, hero, grid), CC.dayPanel(ui.sel))];
  }

  // ---------- week and day time grid ----------
  let tgScroll = -1;
  function hourPx() { return S.density === 'compact' ? 36 : 46; }
  function drag(e, o, el, mode) {
    if (e.button > 0) return;
    e.stopPropagation();
    const touch = e.pointerType !== 'mouse', hh = hourPx(), sx = e.clientX, sy = e.clientY, m0 = CC.toMin(o.time), cols = Array.from(document.querySelectorAll('.tg-col')), home = el.parentElement.getBoundingClientRect();
    let active = false, moved = false, nd = o.date, nm = m0, ndur = o.dur, timer = 0;
    const begin = () => { active = true; el.classList.add('drag'); };
    const stop = (cancel) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', cx); clearTimeout(timer); el.classList.remove('drag');
      if (cancel) { el.style.transform = ''; return; }
      if (active && moved) { CC.move(o, nd, CC.fromMin(nm), ndur); CC.toast(mode === 'size' ? 'Now ' + CC.fmtDur(ndur) + ' long' : 'Moved to ' + CC.shortDate(nd) + ', ' + CC.fmtTime(CC.fromMin(nm))); R.tick(); CC.render(); }
      else if (active && touch) CC.itemMenu(o, sx, sy); else CC.openEditor(o);
    };
    const mv = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!active) { if (touch) { if (Math.hypot(dx, dy) > 8) stop(true); return; } if (Math.hypot(dx, dy) < 5) return; begin(); }
      moved = true;
      if (mode === 'size') { ndur = Math.max(15, Math.round((o.dur + dy / hh * 60) / 15) * 15); el.style.height = ndur / 60 * hh + 'px'; return; }
      const col = cols.find((c) => { const r = c.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX < r.right; });
      const cr = col ? col.getBoundingClientRect() : home; if (col) nd = col.dataset.date;
      nm = Math.max(0, Math.min(1425, Math.round((m0 + dy / hh * 60) / 15) * 15));
      el.style.transform = 'translate(' + (cr.left - home.left) + 'px,' + (nm - m0) / 60 * hh + 'px)';
    };
    const up = () => stop(false), cx = () => stop(true);
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', cx);
    if (touch) timer = setTimeout(begin, 350);
  }
  function timeGrid(dates) {
    const hh = hourPx(), today = CC.today(), by = group(CC.visible(dates[0], dates[dates.length - 1])), now = new Date();
    const head = h('div', { class: 'tg-head' }, h('div', {}), dates.map((d) => { const x = CC.fromYmd(d); return h('button', { type: 'button', class: d === today ? 'today' : '', 'aria-label': CC.longDate(d), onclick: () => { ui.sel = d; ui.dayShown = null; CC.setCal('day'); } }, CC.WD[x.getDay()], h('b', { text: String(x.getDate()) })); }));
    const all = h('div', { class: 'tg-all' }, h('div', { class: 'gut', text: 'any time' }), dates.map((d) => h('div', {}, (by[d] || []).filter((o) => !o.time).map((o) => h('button', { class: 'mchip ' + o.st, type: 'button', style: Object.assign({ border: '0' }, cstyle(o.it)), onclick: () => CC.openEditor(o), oncontextmenu: (e) => { e.preventDefault(); CC.itemMenu(o, e.clientX, e.clientY); }, text: (o.it.kind === 'task' ? '☐ ' : '') + o.it.title })))));
    const inner = h('div', { class: 'tg-inner' }, h('div', { class: 'tg-gut' }, Array.from({ length: 23 }, (_, i) => h('span', { style: { top: (i + 1) * hh + 'px' }, text: S.h24 ? CC.pad(i + 1) + ':00' : ((i + 1) % 12 || 12) + (i + 1 < 12 ? 'a' : 'p') }))));
    for (const d of dates) {
      const col = h('div', { class: 'tg-col' + (d === today ? ' today' : ''), 'data-date': d, onclick: (e) => { if (e.target !== col) return; const m = Math.floor((e.clientY - col.getBoundingClientRect().top) / hh * 2) * 30; CC.openEditor(null, { date: d, time: CC.fromMin(Math.max(0, Math.min(1410, m))), kind: 'appt' }); } });
      const evs = (by[d] || []).filter((o) => o.time), lanes = [], clash = new Set(); CC.conflicts(d).forEach((p) => { clash.add(p[0].key); clash.add(p[1].key); });
      for (const o of evs) { const s = CC.toMin(o.time), e = s + (o.it.kind === 'appt' ? o.dur : 30); let l = lanes.findIndex((end) => end <= s); if (l < 0) l = lanes.push(0) - 1; lanes[l] = e; o.lane = l; o.s = s; o.e = e; }
      for (const o of evs) {
        const el = h('div', { class: 'ev ' + o.st + (clash.has(o.key) ? ' clash' : ''), role: 'button', tabindex: '0', 'aria-label': o.it.title + ', ' + CC.fmtTime(o.time), style: Object.assign({ top: o.s / 60 * hh + 'px', height: Math.max(20, (o.e - o.s) / 60 * hh - 2) + 'px', left: 'calc(' + (o.lane / lanes.length * 100) + '% + 1px)', width: 'calc(' + (100 / lanes.length) + '% - 3px)' }, cstyle(o.it)),
          onpointerdown: (e) => drag(e, o, el, 'move'), onclick: (e) => e.stopPropagation(), onkeydown: (e) => { if (e.key === 'Enter') CC.openEditor(o); }, oncontextmenu: (e) => { e.preventDefault(); CC.itemMenu(o, e.clientX, e.clientY); } },
          o.it.title, h('small', { text: CC.fmtTime(o.time) }), o.it.kind === 'appt' && h('span', { class: 'rs', onpointerdown: (e) => drag(e, o, el, 'size') }));
        el.addEventListener('touchmove', (e) => { if (el.classList.contains('drag')) e.preventDefault(); }, { passive: false });
        col.append(el);
      }
      if (d === today) col.append(h('div', { class: 'nowline', style: { top: (now.getHours() * 60 + now.getMinutes()) / 60 * hh + 'px' } }));
      inner.append(col);
    }
    const body = h('div', { class: 'tg-body', onscroll: (e) => { tgScroll = e.currentTarget.scrollTop; } }, inner);
    setTimeout(() => { body.scrollTop = tgScroll >= 0 ? tgScroll : Math.max(0, (S.dayFrom - 1) * hh); }, 0);
    return h('div', { class: 'tg glass ' + ui.dir, style: { '--n': dates.length } }, head, all, body);
  }
  function weekView() { const ws = CC.weekStart(ui.sel), dates = Array.from({ length: 7 }, (_, i) => CC.shift(ws, i)), a = CC.fromYmd(ws), b = CC.fromYmd(dates[6]); return [tools(CC.MONTHS[a.getMonth()].slice(0, 3) + ' ' + a.getDate() + ' – ' + (a.getMonth() !== b.getMonth() ? CC.MONTHS[b.getMonth()].slice(0, 3) + ' ' : '') + b.getDate()), timeGrid(dates), h('p', { class: 'hint glass', style: { padding: '8px 12px' }, text: 'Tap an empty slot to add. Drag an appointment to move it, or drag its bottom edge to change how long it lasts. On a touch screen, hold it for a moment first.' })]; }
  function dayView() { return [tools(CC.shortDate(ui.sel)), h('div', { class: 'cal-layout split' }, timeGrid([ui.sel]), CC.dayPanel(ui.sel))]; }

  // ---------- year ----------
  function yearView() {
    const y = CC.fromYmd(ui.sel).getFullYear(), today = CC.today(), counts = {};
    for (const o of CC.visible(y + '-01-01', y + '-12-31')) counts[o.date] = (counts[o.date] || 0) + 1;
    return [tools(String(y)), h('div', { class: 'year ' + ui.dir }, CC.MONTHS.map((name, m) => {
      const lead = (new Date(y, m, 1).getDay() - S.weekStart + 7) % 7, n = new Date(y, m + 1, 0).getDate(), g = h('div', { class: 'ymg' });
      for (let i = 0; i < lead; i++) g.append(h('span', {}));
      for (let d = 1; d <= n; d++) { const ds = y + '-' + CC.pad(m + 1) + '-' + CC.pad(d), k = Math.min(4, counts[ds] || 0); g.append(h('button', { type: 'button', class: ds === today ? 'today' : '', style: { '--k': k }, 'aria-label': CC.longDate(ds) + (k ? ', ' + counts[ds] + ' items' : ''), onclick: () => { ui.sel = ds; ui.dayShown = null; CC.setCal('day'); }, text: String(d) })); }
      return h('div', { class: 'ym glass' }, h('button', { type: 'button', onclick: () => { ui.sel = y + '-' + CC.pad(m + 1) + '-01'; CC.setCal('month'); } }, name), g);
    }))];
  }
  CC.views = { cal: () => ({ day: dayView, week: weekView, year: yearView }[S.calView] || monthView)() };

  // ---------- agenda ----------
  CC.views.agenda = () => {
    const t = CC.today(), tabs = [['up', 'Upcoming'], ['over', 'Overdue'], ['done', 'Done and missed'], ['canc', 'Canceled and archived']];
    const over = CC.visible(CC.shift(t, -120), t).filter(CC.isOverdue).sort((a, b) => a.date < b.date ? -1 : 1);
    let body;
    if (ui.agenda === 'up') {
      const by = group(CC.visible(t, CC.shift(t, 60)).filter((o) => o.st === 'active' && !CC.isOverdue(o))), days = Object.keys(by).sort();
      body = days.length ? h('div', { class: 'tl' }, days.map((d) => h('div', { class: 'tl-day' }, h('h3', { text: d === t ? 'Today' : d === CC.shift(t, 1) ? 'Tomorrow' : CC.longDate(d) }), list(by[d], false, '')))) : h('div', { class: 'empty', text: 'Nothing coming up in the next 60 days.' });
    } else if (ui.agenda === 'over') body = list(over, true, 'Nothing overdue. Everything is ticked off.');
    else if (ui.agenda === 'done') body = list(CC.visible(CC.shift(t, -60), CC.shift(t, 1)).filter((o) => o.st === 'done' || o.st === 'missed').sort((a, b) => a.date < b.date ? 1 : -1), true, 'Nothing ticked off in the last 60 days yet.');
    else {
      const l = [];
      for (const it of CC.D.items) { if (it.status === 'canceled' || it.archived) l.push(CC.find(it.id + '@' + it.date)); else if (it.rr) for (const d in it.over || {}) if (it.over[d].st === 'canceled') l.push(CC.find(it.id + '@' + d)); }
      body = h('div', { class: 'col' }, l.length ? h('ul', { class: 'items' }, l.map((o) => h('li', { class: 'item canceled', style: cstyle(o.it) }, h('div', { class: 'item-main' }, h('span', { class: 'item-title', text: o.it.title }), h('span', { class: 'item-meta', text: CC.shortDate(o.date) + (o.it.archived ? ' · Archived' : ' · Canceled') })),
        h('button', { class: 'btn small', type: 'button', onclick: () => { o.it.archived = false; CC.setStatus(o, 'active'); if (o.it.status === 'canceled') o.it.status = 'active'; CC.save(); CC.toast('Restored'); CC.render(); } }, 'Restore'),
        !o.it.archived && !o.it.rr && h('button', { class: 'btn small', type: 'button', onclick: () => { o.it.archived = true; CC.save(); CC.render(); } }, 'Archive'),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => CC.removeItem(o) }, 'Delete')))) : h('div', { class: 'empty', text: 'Canceled and archived items wait here, out of the way of your calendar.' }));
    }
    return h('section', { class: 'glass card fade-in' }, h('div', { class: 'row between' }, h('h2', { text: 'Agenda' }), h('button', { class: 'btn primary small', type: 'button', onclick: () => CC.openEditor(null, { date: t }) }, CC.icon('plus'), 'Add')),
      h('div', { class: 'chips' }, tabs.map((x) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ui.agenda === x[0]), onclick: () => { ui.agenda = x[0]; CC.render(); } }, x[1], x[0] === 'over' && over.length ? ' (' + over.length + ')' : ''))), body);
  };

  // ---------- tasks ----------
  CC.views.tasks = () => {
    const t = CC.today(), all = CC.visible(CC.shift(t, -90), CC.shift(t, 90)).filter((o) => o.it.kind === 'task'), sort = (l) => l.sort((a, b) => (PR[a.it.prio] - PR[b.it.prio]) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const open = all.filter((o) => o.st === 'active'), late = sort(open.filter((o) => o.date < t)), now = sort(open.filter((o) => o.date === t)), next = sort(open.filter((o) => o.date > t)), done = all.filter((o) => o.st === 'done').sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 15);
    const pct = all.length ? Math.round(all.filter((o) => o.st === 'done').length / all.length * 100) : 0;
    const sec = (title, l, cls) => l.length ? [h('h3', { class: cls || '', text: title + ' (' + l.length + ')' }), list(l, true, '')] : null;
    return h('section', { class: 'glass card fade-in' }, h('div', { class: 'row between' }, h('h2', { text: 'Tasks' }), h('button', { class: 'btn primary small', type: 'button', onclick: () => CC.openEditor(null, { kind: 'task', date: t }) }, CC.icon('plus'), 'Add task')),
      all.length ? h('div', { class: 'col', style: { gap: '4px' } }, h('div', { class: 'meter' }, h('i', { style: { width: pct + '%' } })), h('span', { class: 'hint', text: all.filter((o) => o.st === 'done').length + ' done out of ' + all.length + '. Sorted by priority, then due date.' })) : h('div', { class: 'empty', text: 'No tasks yet. Add one and it shows here and on its due day.' }),
      sec('Overdue', late, 'late'), sec('Due today', now), sec('Coming up', next), sec('Done', done));
  };
})(window.CC);
