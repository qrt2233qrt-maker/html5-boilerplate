/* Adding and editing: appointments, tasks, reminders, notes, the photo picker and search. */
(function (CC) {
  'use strict';
  const { $, h, S, ui, R } = CC, D = CC.D;
  const chipRow = (opts, cur, on) => h('div', { class: 'chips' }, opts.map((o) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(cur === o[0]), onclick: () => on(o[0]) }, o[1])));
  CC.chipRow = chipRow;
  const catOpts = () => [['', 'No category']].concat(D.cats.map((c) => [c.id, c.name]));

  CC.openPicker = (title, onPick) => CC.openModal(CC.sheet(title,
    h('div', { class: 'row' }, h('button', { class: 'btn primary small', type: 'button', onclick: () => CC.pickFiles('image/*', async (f) => { const id = await CC.addPhotos(f); if (id) { CC.closeModal(); onPick(id); } }) }, 'Use a new photo of mine')),
    CC.pool().length ? null : h('p', { class: 'hint', text: 'No pictures are switched on yet.' }),
    h('div', { class: 'photos' }, CC.pool().map((id) => h('button', { class: 'ph', type: 'button', 'aria-label': 'Use this photo', onclick: () => { CC.closeModal(); onPick(id); } }, h('img', { src: CC.srcOf(id), alt: '' }))))));

  // ---------- appointment / task / reminder ----------
  CC.openEditor = (o, defaults) => {
    const d = JSON.parse(JSON.stringify(o ? o.it : Object.assign(CC.blank(), { date: ui.sel, rems: S.defRems.map((m) => ({ m })), nag: S.defNag }, defaults || {})));
    const kindBox = h('div'), prioBox = h('div'), remBox = h('div', { class: 'col', style: { gap: '6px' } }), rrBox = h('div', { class: 'col' }), warn = h('div'), err = h('p', { class: 'late', role: 'alert' });
    const durField = h('div', { class: 'field' }, h('label', { for: 'ed-dur', text: 'How long' }), CC.select('ed-dur', [15, 30, 45, 60, 90, 120, 180, 240, 480].concat([15, 30, 45, 60, 90, 120, 180, 240, 480].includes(d.dur) ? [] : [d.dur]).sort((a, b) => a - b).map((m) => [m, CC.fmtDur(m)]), d.dur, (v) => { d.dur = +v; paintWarn(); }));
    const dateLab = h('label', { for: 'ed-date' });
    function paintWarn() {
      const cl = d.kind === 'appt' ? CC.clashWith(d.date, d.time, d.dur, d.id) : [];
      if (!cl.length) return CC.fill(warn, );
      const slot = CC.freeSlots(d.date, d.id).find((s) => s[1] - s[0] >= d.dur && s[0] > CC.toMin(d.time));
      CC.fill(warn, h('div', { class: 'banner' }, CC.icon('warn'), h('div', { class: 'col', style: { gap: '6px' } }, h('span', { text: 'This overlaps with ' + cl.map((c) => '"' + c.it.title + '" at ' + CC.fmtTime(c.time)).join(' and ') + '.' }),
        slot && h('button', { class: 'btn small', type: 'button', onclick: () => { d.time = CC.fromMin(slot[0]); $('#ed-time').value = d.time; paintWarn(); } }, 'Use the next free time, ' + CC.fmtTime(CC.fromMin(slot[0]))))));
    }
    function paint() {
      CC.fill(kindBox, chipRow(Object.entries(CC.KINDS), d.kind, (k) => { d.kind = k; paint(); }));
      CC.fill(prioBox, chipRow(Object.entries(CC.PRIO), d.prio, (p) => { d.prio = p; paint(); }));
      dateLab.textContent = d.kind === 'task' ? 'Due date' : 'Date'; durField.hidden = d.kind !== 'appt';
      const has = (m) => d.rems.some((r) => r.m === m && !r.at), custom = d.rems.filter((r) => r.at || !R.PRESETS.some((p) => p[0] === r.m));
      CC.fill(remBox, 
        h('div', { class: 'chips' }, R.PRESETS.map((p) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(has(p[0])), onclick: () => { d.rems = has(p[0]) ? d.rems.filter((r) => r.at || r.m !== p[0]) : d.rems.concat({ m: p[0] }); paint(); } }, p[1]))),
        custom.length ? h('div', { class: 'chips' }, custom.map((r) => h('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', 'aria-label': 'Remove reminder ' + R.label(r), onclick: () => { d.rems = d.rems.filter((x) => x !== r); paint(); } }, R.label(r), ' ×'))) : null,
        h('div', { class: 'row' }, h('input', { type: 'number', class: 'num', id: 'ed-cn', min: '1', value: '3', 'aria-label': 'Custom amount' }), CC.select('ed-cu', [[1, 'minutes before'], [60, 'hours before'], [1440, 'days before']], 60), h('button', { class: 'btn small', type: 'button', onclick: () => { const m = Math.round(+$('#ed-cn').value * +$('#ed-cu').value); if (m > 0 && !d.rems.some((r) => r.m === m)) { d.rems.push({ m }); paint(); } } }, 'Add')),
        h('div', { class: 'row' }, h('input', { type: 'datetime-local', id: 'ed-cat', 'aria-label': 'Exact date and time', style: { flex: '1', width: 'auto' } }), h('button', { class: 'btn small', type: 'button', onclick: () => { const v = $('#ed-cat').value; if (v) { d.rems.push({ at: v }); paint(); } } }, 'Add exact time')),
        h('label', { class: 'cl-row' }, h('input', { type: 'checkbox', id: 'ed-nag-on', checked: d.nag > 0, onchange: (e) => { d.nag = e.target.checked ? (d.nag || 10) : 0; paint(); } }), h('span', { text: 'Keep reminding me until I tick it done' })),
        d.nag > 0 && h('div', { class: 'row' }, 'every', h('input', { type: 'number', class: 'num', id: 'ed-nag', min: '1', value: d.nag, 'aria-label': 'Minutes between reminders', oninput: (e) => { d.nag = Math.max(1, +e.target.value || 1); } }), 'min, starting',
          CC.select('ed-nagfrom', [['start', 'at the scheduled time'], ['first', 'from the first reminder']], d.nagFrom || 'start', (v) => { d.nagFrom = v; })));
      const r = d.rr;
      CC.fill(rrBox, h('div', { class: 'two' },
        h('div', { class: 'field' }, h('label', { for: 'ed-rf', text: 'Repeat' }), CC.select('ed-rf', [['', 'Does not repeat'], ['d', 'Daily'], ['w', 'Weekly'], ['m', 'Monthly'], ['y', 'Yearly']], r ? r.f : '', (v) => { d.rr = v ? Object.assign({ n: 1, days: [], until: '', count: 0 }, d.rr, { f: v }) : null; paint(); })),
        r && h('div', { class: 'field' }, h('label', { for: 'ed-rn', text: 'Every' }), h('div', { class: 'row' }, h('input', { type: 'number', class: 'num', id: 'ed-rn', min: '1', value: r.n, oninput: (e) => { r.n = Math.max(1, +e.target.value || 1); } }), { d: 'day(s)', w: 'week(s)', m: 'month(s)', y: 'year(s)' }[r.f]))),
        r && r.f === 'w' && h('div', { class: 'field' }, h('span', { class: 'lab', text: 'On these days (leave empty for the same weekday)' }), h('div', { class: 'chips' }, CC.WD.map((w, i) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(r.days.includes(i)), onclick: () => { r.days = r.days.includes(i) ? r.days.filter((x) => x !== i) : r.days.concat(i); paint(); } }, w)))),
        r && h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 'ed-re', text: 'Ends' }), CC.select('ed-re', [['never', 'Never'], ['until', 'On a date'], ['count', 'After a number of times']], r.until ? 'until' : r.count ? 'count' : 'never', (v) => { r.until = v === 'until' ? CC.shift(d.date, 30) : ''; r.count = v === 'count' ? 10 : 0; paint(); })),
          r.until ? h('div', { class: 'field' }, h('label', { for: 'ed-ru', text: 'Last day' }), h('input', { type: 'date', id: 'ed-ru', value: r.until, onchange: (e) => { r.until = e.target.value || r.until; } })) : r.count ? h('div', { class: 'field' }, h('label', { for: 'ed-rc', text: 'Times' }), h('input', { type: 'number', id: 'ed-rc', min: '1', value: r.count, oninput: (e) => { r.count = Math.max(1, +e.target.value || 1); } })) : null));
      paintWarn();
    }
    paint();
    const act = (label, fn, cls) => h('button', { class: 'btn small ' + (cls || ''), type: 'button', onclick: fn }, label);
    const finish = (msg) => { CC.closeModal(); if (msg) CC.toast(msg); R.tick(); CC.render(); };
    const linked = o ? D.notes.filter((n) => n.linked === d.id && !n.deleted) : [];
    const form = h('form', { class: 'sheet', role: 'dialog', 'aria-label': o ? 'Edit' : 'Add', onsubmit: (e) => {
      e.preventDefault();
      d.title = $('#ed-title').value.trim(); d.notes = $('#ed-notes').value.trim(); d.cat = $('#ed-cat-sel').value;
      if (!d.title) { err.textContent = 'Give it a name first.'; $('#ed-title').focus(); return; }
      if (!d.date) { err.textContent = 'Pick a date.'; return; }
      d.updated = Date.now(); d.example = false;
      if (o) { const moved = o.it.date !== d.date || o.it.time !== d.time; Object.assign(o.it, d, { over: moved ? {} : o.it.over || {}, moved: moved && !d.rr ? (o.it.moved || 0) + 1 : o.it.moved }); for (const k in CC.alerts) if (k.startsWith(d.id + '@')) delete CC.alerts[k]; CC.saveAlerts(); }
      else D.items.push(d);
      CC.save(); if (!d.rr) { ui.sel = d.date; ui.dayShown = null; } finish('Saved');
    } },
      h('div', { class: 'sheet-head' }, h('h2', { text: o ? 'Edit' : 'Add something' }), h('button', { class: 'ib', type: 'button', 'aria-label': 'Close', onclick: CC.closeModal }, CC.icon('x'))),
      o && o.it.rr && h('div', { class: 'banner' }, CC.icon('repeat'), h('div', { class: 'col', style: { gap: '6px' } }, h('span', { text: 'This repeats. Changes here apply to every time it happens.' }), act('Change only ' + CC.shortDate(o.date), () => { const c = CC.detach(o); CC.save(); CC.openEditor(CC.find(c.id + '@' + c.date)); }))),
      kindBox,
      h('div', { class: 'field' }, h('label', { for: 'ed-title', text: 'Name' }), h('input', { type: 'text', id: 'ed-title', maxlength: '120', value: d.title, autocomplete: 'off', placeholder: 'Dentist, essay, call Sam…' })),
      h('div', { class: 'two' },
        h('div', { class: 'field' }, dateLab, h('input', { type: 'date', id: 'ed-date', value: d.date, onchange: (e) => { d.date = e.target.value; paintWarn(); } })),
        h('div', { class: 'field' }, h('label', { for: 'ed-time', text: 'Time (optional)' }), h('input', { type: 'time', id: 'ed-time', value: d.time, onchange: (e) => { d.time = e.target.value; paintWarn(); } })),
        durField),
      warn,
      h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 'ed-cat-sel', text: 'Category' }), CC.select('ed-cat-sel', catOpts(), d.cat)), h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Priority' }), prioBox)),
      h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Remind me (pick as many as you like)' }), remBox),
      h('details', { class: 'more-opts', open: !!d.rr }, h('summary', { text: 'Repeat' }), rrBox),
      h('div', { class: 'field' }, h('label', { for: 'ed-notes', text: 'Notes' }), h('textarea', { id: 'ed-notes', rows: '3' }, d.notes)),
      o && h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Attached notes' }), linked.map((n) => h('button', { class: 'note-inline', type: 'button', style: n.color ? { '--c': n.color } : null, onclick: () => CC.openNote(n) }, n.title || 'Untitled note')), h('div', { class: 'row' }, act('Attach a new note', () => CC.openNote(null, { linked: d.id, title: d.title })))),
      err,
      o && h('div', { class: 'chips' },
        o.st !== 'done' ? act('✓ Done', (e) => { CC.closeModal(); CC.complete(o, e); }) : act('Not done', () => { CC.setStatus(o, 'active'); finish(); }),
        o.st === 'active' && act('Missed', () => { CC.setStatus(o, 'missed'); finish('Marked as missed'); }),
        o.st !== 'canceled' ? act('Cancel it', () => { CC.setStatus(o, 'canceled'); finish('Canceled. Find it under Agenda, Canceled.'); }, 'danger') : act('Restore', () => { CC.setStatus(o, 'active'); if (o.it.status === 'canceled') { o.it.status = 'active'; CC.save(); } finish('Restored'); }),
        o.it.rr && o.st !== 'canceled' && act('Cancel all repeats', () => { CC.setStatus(o, 'canceledAll'); finish('All repeats canceled'); }, 'danger'),
        act(o.it.archived ? 'Unarchive' : 'Archive', () => { o.it.archived = !o.it.archived; CC.save(); finish(o.it.archived ? 'Archived' : 'Back on the calendar'); }),
        act('Delete', async () => { if (await CC.removeItem(o)) CC.closeModal(); }, 'danger')),
      h('div', { class: 'row between' }, h('span', { class: 'hint', text: o ? '' : 'Press Enter to save.' }), h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
    CC.openModal(form);
    if (!o) $('#ed-title').focus();
  };

  // ---------- notes ----------
  const NOTE_COLORS = ['', '#f08fb8', '#a99bf5', '#6fb6f5', '#5fcfa8', '#f6d36b', '#f5b072'];
  const noteText = (n) => (n.title + ' ' + n.body + ' ' + (n.labels || []).join(' ') + ' ' + (n.checklist || []).map((c) => c.t).join(' ')).toLowerCase();
  CC.views.notes = () => {
    const tab = ui.notesTab, q = ui.noteQ.trim().toLowerCase();
    const l = D.notes.filter((n) => tab === 'trash' ? n.deleted : tab === 'arch' ? n.archived && !n.deleted : !n.archived && !n.deleted)
      .filter((n) => (!ui.noteCat || n.cat === ui.noteCat) && (!q || q.split(/\s+/).every((w) => noteText(n).includes(w))))
      .sort((a, b) => (b.pinned - a.pinned) || b.updated - a.updated);
    return h('section', { class: 'glass card fade-in' },
      h('div', { class: 'row between' }, h('h2', { text: 'Notes' }), h('button', { class: 'btn primary small', type: 'button', onclick: () => CC.openNote(null) }, CC.icon('plus'), 'New note')),
      h('input', { type: 'search', id: 'note-q', placeholder: 'Search notes', 'aria-label': 'Search notes', value: ui.noteQ, oninput: (e) => { ui.noteQ = e.target.value; CC.render(); } }),
      chipRow([['active', 'Notes'], ['arch', 'Archived'], ['trash', 'Trash']], tab, (t) => { ui.notesTab = t; CC.render(); }),
      h('div', { class: 'chips' }, [['', 'All']].concat(D.cats.map((c) => [c.id, c.name])).map((c) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ui.noteCat === c[0]), onclick: () => { ui.noteCat = c[0]; CC.render(); } }, c[1]))),
      tab === 'trash' && l.length ? h('div', { class: 'row' }, h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await CC.confirm('Empty the trash? These notes cannot be brought back.', 'Empty trash', true)) { for (const n of D.notes.filter((x) => x.deleted)) for (const f of n.files || []) CC.idb.del('files', f.id); D.notes = D.notes.filter((x) => !x.deleted); CC.save(); CC.render(); } } }, 'Empty trash')) : null,
      l.length ? h('div', { class: 'notes' }, l.map((n) => { const cl = n.checklist || [], c = CC.cat(n.cat); return h('button', { class: 'note', type: 'button', style: n.color ? { '--c': n.color } : null, onclick: () => CC.openNote(n) },
        h('b', { text: (n.pinned ? '📌 ' : '') + (n.title || 'Untitled note') }), n.example && h('span', { class: 'eg', style: { 'align-self': 'flex-start' }, text: 'Example' }), n.body && h('p', { text: n.body }),
        cl.length ? h('span', { class: 'hint', text: cl.filter((x) => x.done).length + ' of ' + cl.length + ' checked' }) : null,
        h('span', { class: 'item-meta' }, c && h('span', { text: c.name }), (n.labels || []).map((x) => h('span', { text: '#' + x })), n.date && h('span', { text: CC.shortDate(n.date) }), (n.files || []).length ? h('span', { text: n.files.length + ' attached' }) : null)); }))
        : h('div', { class: 'empty', text: tab === 'trash' ? 'The trash is empty.' : tab === 'arch' ? 'No archived notes.' : q || ui.noteCat ? 'No notes match.' : 'No notes yet. Write one, add a checklist, attach photos, or pin it to a day.' }));
  };
  CC.openNote = (n, defaults) => {
    const d = JSON.parse(JSON.stringify(n || Object.assign(CC.blankNote(), defaults || {}))), clBox = h('div', { class: 'col', style: { gap: '6px' } }), colBox = h('div', { class: 'chips' }), attBox = h('div', { class: 'att' });
    const grab = () => { d.title = $('#nt-title').value.trim(); d.body = $('#nt-body').value; d.cat = $('#nt-cat').value; d.date = $('#nt-date').value; d.linked = $('#nt-link').value; d.labels = $('#nt-labels').value.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean); };
    const commit = (msg) => { grab(); d.updated = Date.now(); d.example = false; const i = D.notes.findIndex((x) => x.id === d.id); if (i >= 0) D.notes[i] = d; else D.notes.push(d); CC.save(); CC.closeModal(); if (msg) CC.toast(msg); CC.render(); };
    function paint() {
      CC.fill(clBox, d.checklist.map((c, i) => h('div', { class: 'cl-row' }, h('input', { type: 'checkbox', checked: c.done, 'aria-label': 'Checked: ' + c.t, onchange: (e) => { c.done = e.target.checked; } }), h('input', { type: 'text', value: c.t, 'aria-label': 'Checklist item ' + (i + 1), oninput: (e) => { c.t = e.target.value; } }), h('button', { class: 'ib', type: 'button', style: { width: '32px', height: '32px' }, 'aria-label': 'Remove item', onclick: () => { d.checklist.splice(i, 1); paint(); } }, CC.icon('x')))),
        h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => { d.checklist.push({ t: '', done: false }); paint(); const ins = clBox.querySelectorAll('input[type="text"]'); ins[ins.length - 1].focus(); } }, 'Add checklist item')));
      CC.fill(colBox, NOTE_COLORS.map((c) => h('button', { class: 'sw', type: 'button', 'aria-label': c ? 'Colour ' + c : 'No colour', 'aria-pressed': String(d.color === c), style: { background: c || 'var(--tint)' }, onclick: () => { d.color = c; paint(); } })));
      CC.fill(attBox, d.files.map((f) => {
        const rm = h('button', { class: 'on-photo', type: 'button', 'aria-label': 'Remove ' + f.name, onclick: () => { d.files = d.files.filter((x) => x !== f); CC.idb.del('files', f.id); paint(); } }, '×');
        if (f.type.startsWith('image/')) { const img = h('img', { alt: f.name }); CC.idb.get('files', f.id).then((r) => { if (r) img.src = URL.createObjectURL(r.blob); }); return h('div', { class: 'ph' }, img, rm); }
        const a = h('a', { target: '_blank', rel: 'noopener', text: f.name }); CC.idb.get('files', f.id).then((r) => { if (r) a.href = URL.createObjectURL(r.blob); });
        return h('div', { class: 'chip' }, a, ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB) ', rm);
      }));
    }
    paint();
    const up = CC.visible(CC.shift(CC.today(), -14), CC.shift(CC.today(), 120)), seen = new Set(), links = [['', 'Not attached']];
    for (const o of up) if (!seen.has(o.it.id)) { seen.add(o.it.id); links.push([o.it.id, o.it.title + ' · ' + CC.shortDate(o.date)]); }
    if (d.linked && !seen.has(d.linked)) { const it = D.items.find((i) => i.id === d.linked); if (it) links.push([it.id, it.title]); }
    const toItem = (kind) => { grab(); const it = Object.assign(CC.blank(), { kind, title: d.title || 'From a note', date: d.date || CC.today(), cat: d.cat, notes: [d.body].concat(d.checklist.map((c) => (c.done ? '[x] ' : '[ ] ') + c.t)).filter(Boolean).join('\n') }); D.items.push(it); d.linked = it.id; commit(); CC.openEditor(CC.find(it.id + '@' + it.date)); };
    const act = (label, fn, cls) => h('button', { class: 'btn small ' + (cls || ''), type: 'button', onclick: fn }, label);
    CC.openModal(h('form', { class: 'sheet', role: 'dialog', 'aria-label': 'Note', onsubmit: (e) => { e.preventDefault(); commit('Note saved'); } },
      h('div', { class: 'sheet-head' }, h('h2', { text: n ? 'Edit note' : 'New note' }), h('button', { class: 'ib', type: 'button', 'aria-label': 'Close', onclick: CC.closeModal }, CC.icon('x'))),
      h('div', { class: 'field' }, h('label', { for: 'nt-title', text: 'Title' }), h('input', { type: 'text', id: 'nt-title', maxlength: '120', value: d.title, autocomplete: 'off' })),
      h('div', { class: 'field' }, h('label', { for: 'nt-body', text: 'Note' }), h('textarea', { id: 'nt-body', rows: '5' }, d.body)),
      h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Checklist' }), clBox),
      h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 'nt-cat', text: 'Category' }), CC.select('nt-cat', catOpts(), d.cat)), h('div', { class: 'field' }, h('label', { for: 'nt-labels', text: 'Labels (comma separated)' }), h('input', { type: 'text', id: 'nt-labels', value: d.labels.join(', ') }))),
      h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Colour' }), colBox),
      h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 'nt-date', text: 'Show on a day (optional)' }), h('input', { type: 'date', id: 'nt-date', value: d.date })), h('div', { class: 'field' }, h('label', { for: 'nt-link', text: 'Attach to' }), CC.select('nt-link', links, d.linked))),
      h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Photos and files' }), attBox, h('div', { class: 'row' }, act('Attach a photo or file', () => CC.pickFiles('', async (files) => { for (const f of files) { if (f.size > 15e6) { CC.toast(f.name + ' is over 15 MB, too big to attach'); continue; } const blob = f.type.startsWith('image/') ? (await CC.shrink(f)) || f : f, id = 'f-' + CC.uid(); await CC.idb.put('files', { id, blob }); d.files.push({ id, name: f.name, type: f.type || 'file', size: blob.size }); } paint(); })))),
      n && h('div', { class: 'chips' },
        n.deleted ? [act('Restore', () => { d.deleted = 0; commit('Note restored'); }), act('Delete for good', async () => { if (await CC.confirm('Delete this note for good? It cannot be brought back.', 'Delete', true)) { for (const f of d.files) CC.idb.del('files', f.id); const i = D.notes.findIndex((x) => x.id === d.id); if (i >= 0) D.notes.splice(i, 1); CC.save(); CC.closeModal(); CC.render(); } }, 'danger')]
          : [act(d.pinned ? 'Unpin' : 'Pin to top', () => { d.pinned = !d.pinned; commit(); }), act(d.archived ? 'Unarchive' : 'Archive', () => { d.archived = !d.archived; commit(d.archived ? 'Archived' : 'Unarchived'); }), act('Make it a task', () => toItem('task')), act('Make it an appointment', () => toItem('appt')), act('Move to trash', () => { d.deleted = Date.now(); commit('In the trash. You can restore it from Notes, Trash.'); }, 'danger')]),
      h('div', { class: 'row between' }, h('span', {}), h('button', { class: 'btn primary', type: 'submit' }, 'Save note'))));
    if (!n) $('#nt-title').focus();
  };

  // ---------- search ----------
  CC.openSearch = () => {
    const out = h('div', { class: 'col' });
    const run = (q) => {
      const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return CC.fill(out, h('p', { class: 'hint', text: 'Search names, notes, categories, priority (try "high") or a date (try "2026-12" or "friday").' }));
      const t = CC.today(), items = [], notes = D.notes.filter((n) => !n.deleted && words.every((w) => noteText(n).includes(w))).slice(0, 15);
      for (const it of D.items) {
        const o = it.rr ? (CC.occs(t, CC.shift(t, 400)).find((x) => x.it === it) || CC.find(it.id + '@' + it.date)) : CC.find(it.id + '@' + it.date), c = CC.cat(it.cat);
        const hay = (it.title + ' ' + it.notes + ' ' + (c ? c.name : '') + ' ' + CC.PRIO[it.prio] + ' ' + CC.KINDS[it.kind] + ' ' + o.date + ' ' + CC.longDate(o.date) + ' ' + o.st).toLowerCase();
        if (words.every((w) => hay.includes(w))) items.push(o); if (items.length >= 25) break;
      }
      CC.fill(out, items.length ? h('ul', { class: 'items' }, items.map((o) => CC.itemRow(o, true))) : null,
        notes.map((n) => h('button', { class: 'note-inline', type: 'button', style: n.color ? { '--c': n.color } : null, onclick: () => CC.openNote(n) }, h('span', { class: 'tag', text: 'Note' }), h('div', { class: 'item-title', text: n.title || 'Untitled note' }))),
        !items.length && !notes.length ? h('div', { class: 'empty', text: 'Nothing matches "' + q.trim() + '".' }) : null);
    };
    CC.openModal(CC.sheet('Search', h('input', { type: 'search', id: 'search-q', placeholder: 'Search everything', 'aria-label': 'Search everything', oninput: (e) => run(e.target.value) }), out));
    run(''); $('#search-q').focus();
  };
})(window.CC);
