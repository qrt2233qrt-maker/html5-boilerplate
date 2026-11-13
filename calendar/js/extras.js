/* Dashboard with focus timer, and Settings. */
(function (CC) {
  'use strict';
  const { $, h, S, ui, R } = CC, D = CC.D;

  // ---------- focus timer ----------
  const P = CC.P = { mode: 'work', left: S.pomo.work * 60, run: false, end: 0, n: 0, task: '' };
  const LABEL = { work: 'Focus', brk: 'Short break', long: 'Long break' }, RING = 2 * Math.PI * 86;
  const total = () => S.pomo[P.mode] * 60, mmss = (s) => CC.pad(Math.floor(s / 60)) + ':' + CC.pad(s % 60);
  function paintTimer() {
    for (const id of ['#pomo-time', '#focus-time']) { const e = $(id); if (e) e.textContent = mmss(P.left); }
    const r = $('#pomo-ring'); if (r) r.style.strokeDashoffset = RING * (1 - P.left / total());
  }
  function setMode(m) { P.mode = m; P.left = total(); P.run = false; }
  setInterval(() => {
    if (!P.run) return;
    P.left = Math.max(0, Math.round((P.end - Date.now()) / 1000)); paintTimer();
    if (P.left > 0) return;
    R.play('bright'); const was = P.mode;
    if (was === 'work') { const t = CC.today(); S.pomoLog[t] = (S.pomoLog[t] || 0) + 1; CC.saveS(); P.n++; setMode(P.n % 4 === 0 ? 'long' : 'brk'); } else setMode('work');
    const msg = was === 'work' ? 'Focus session done. Time for a break.' : 'Break over. Ready for the next focus session?';
    CC.toast(msg); try { if (R.perm() === 'granted') new Notification(msg); } catch (e) { /* not allowed here */ }
    CC.render();
  }, 1000);
  const toggle = () => { P.run = !P.run; if (P.run) P.end = Date.now() + P.left * 1000; CC.render(); };
  CC.renderFocus = () => {
    const f = $('#focus'); f.hidden = !ui.focus; if (!ui.focus) return;
    CC.fill(f, h('span', { class: 'tag', text: LABEL[P.mode] }), h('div', { class: 'big', id: 'focus-time', text: mmss(P.left) }), P.task && h('h2', { text: P.task }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: toggle }, P.run ? 'Pause' : 'Start'), h('button', { class: 'btn', type: 'button', onclick: () => { ui.focus = false; CC.render(); } }, 'Leave focus mode')));
  };
  CC.views.focus = () => {
    const t = CC.today(), st = CC.stats(), todays = CC.visible(t, t).sort(CC.byTime), open = todays.filter((o) => o.st === 'active'), late = CC.visible(CC.shift(t, -120), t).filter(CC.isOverdue);
    const free = CC.freeSlots(t), freeMin = free.reduce((a, s) => a + s[1] - s[0], 0), next = open.find((o) => o.time && CC.dt(o.date, o.time) > new Date()), max = Math.max(1, ...st.days.map((d) => d.total));
    const tasks = CC.visible(CC.shift(t, -30), CC.shift(t, 14)).filter((o) => o.it.kind === 'task' && o.st === 'active');
    return h('div', { class: 'dash fade-in' },
      h('section', { class: 'glass card' }, h('span', { class: 'tag', text: CC.longDate(t) }), h('h2', { text: open.length ? open.length + (open.length === 1 ? ' thing' : ' things') + ' left today' : todays.length ? 'Everything for today is ticked off' : 'A clear day' }),
        next && h('p', { text: 'Next: ' + next.it.title + ' at ' + CC.fmtTime(next.time) + ' (' + R.rel(CC.dt(next.date, next.time) - Date.now()) + ').' }),
        h('p', { class: 'hint', text: freeMin ? CC.fmtDur(freeMin) + ' free before ' + S.dayTo + ':00. ' + (free.length ? 'Open slots: ' + free.slice(0, 3).map((s) => CC.fmtTime(CC.fromMin(s[0])) + '–' + CC.fmtTime(CC.fromMin(s[1]))).join(', ') + '.' : '') : 'No free gaps left in your day hours.' }),
        CC.conflicts(t).map((p) => h('div', { class: 'banner' }, CC.icon('warn'), '"' + p[0].it.title + '" and "' + p[1].it.title + '" overlap today.')),
        todays.length ? h('ul', { class: 'items' }, todays.map((o) => CC.itemRow(o, false))) : null,
        h('div', { class: 'row' }, h('button', { class: 'btn primary small', type: 'button', onclick: () => CC.openEditor(null, { date: t }) }, CC.icon('plus'), 'Plan something'))),
      h('section', { class: 'glass card' }, h('span', { class: 'tag', text: LABEL[P.mode] + ' · ' + (S.pomoLog[t] || 0) + ' sessions today' }),
        h('div', { class: 'ring' }, h('span', { html: '<svg viewBox="0 0 190 190"><circle cx="95" cy="95" r="86"/><circle class="p" id="pomo-ring" cx="95" cy="95" r="86" stroke-dasharray="' + RING + '" stroke-dashoffset="' + RING * (1 - P.left / total()) + '"/></svg>' }), h('div', { class: 'big', id: 'pomo-time', text: mmss(P.left) })),
        h('div', { class: 'row', style: { 'justify-content': 'center' } }, h('button', { class: 'btn primary', type: 'button', onclick: toggle }, P.run ? 'Pause' : 'Start'), h('button', { class: 'btn', type: 'button', onclick: () => { setMode(P.mode); CC.render(); } }, 'Reset'), h('button', { class: 'btn', type: 'button', onclick: () => { setMode(P.mode === 'work' ? 'brk' : 'work'); CC.render(); } }, P.mode === 'work' ? 'Skip to break' : 'Skip to focus'), h('button', { class: 'btn', type: 'button', onclick: () => { ui.focus = true; CC.render(); } }, 'Focus mode')),
        h('div', { class: 'field' }, h('label', { for: 'pomo-task', text: 'Working on' }), CC.select('pomo-task', [['', 'Nothing chosen']].concat(tasks.map((o) => [o.it.title, o.it.title])), tasks.some((o) => o.it.title === P.task) ? P.task : '', (v) => { P.task = v; })),
        h('div', { class: 'two' }, [['work', 'Focus (min)'], ['brk', 'Break (min)'], ['long', 'Long break (min)']].map((x) => h('div', { class: 'field' }, h('label', { for: 'pomo-' + x[0], text: x[1] }), h('input', { type: 'number', id: 'pomo-' + x[0], min: '1', max: '180', value: S.pomo[x[0]], onchange: (e) => { S.pomo[x[0]] = Math.max(1, Math.min(180, +e.target.value || 1)); CC.saveS(); if (!P.run) setMode(P.mode); CC.render(); } }))))),
      h('section', { class: 'glass card' }, h('span', { class: 'tag', text: 'This week' }), h('div', { class: 'row', style: { 'align-items': 'baseline' } }, h('span', { class: 'big', text: String(st.done) }), h('span', { class: 'hint', text: 'done out of ' + st.total })),
        h('div', { class: 'meter' }, h('i', { style: { width: st.pct + '%' } })),
        h('div', { class: 'bars', role: 'img', 'aria-label': 'Items done per day over the last 7 days' }, st.days.map((d) => h('div', {}, h('span', { text: d.done + '/' + d.total }), h('i', { style: { height: Math.round(d.done / max * 100) + '%' } }), CC.WD[CC.fromYmd(d.d).getDay()]))),
        h('p', { class: 'hint', text: 'Bars show what you ticked off each day, out of what was planned.' })),
      h('section', { class: 'glass card' }, h('span', { class: 'tag', text: 'Needs attention' }), h('h2', { class: late.length ? 'late' : '', text: late.length ? late.length + ' overdue' : 'Nothing overdue' }),
        late.length ? h('ul', { class: 'items' }, late.slice(0, 5).map((o) => CC.itemRow(o, true))) : h('p', { class: 'hint', text: 'Items only leave this list when you tick them done, mark them missed, or cancel them.' }),
        late.length > 5 && h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => { ui.view = 'agenda'; ui.agenda = 'over'; CC.render(); } }, 'See all overdue'))));
  };

  // ---------- settings ----------
  const card = (title, ...kids) => h('section', { class: 'glass card' }, h('h2', { text: title }), kids);
  const field = (label, ...kids) => h('div', { class: 'field' }, h('span', { class: 'lab', text: label }), kids);
  const setS = (fn, rerender) => { fn(); CC.saveS(); CC.applyLook(); if (rerender !== false) CC.render(); };
  const slider = (id, label, min, max, stepv, val, unit, on) => { const out = h('span', { class: 'hint', text: val + unit }); return h('div', { class: 'field' }, h('div', { class: 'row between' }, h('label', { for: id, text: label }), out), h('input', { type: 'range', id, min, max, step: stepv, value: val, oninput: (e) => { out.textContent = e.target.value + unit; setS(() => on(+e.target.value), false); } })); };
  function backup() { return JSON.stringify({ app: 'cozy-calendar', v: 2, at: new Date().toISOString(), data: D, settings: S }); }
  async function restore(text) {
    let p; try { p = JSON.parse(text); } catch (e) { return CC.toast('That is not a backup from this calendar.'); }
    if (!p || !p.data || !Array.isArray(p.data.items) || !Array.isArray(p.data.notes)) return CC.toast('That is not a backup from this calendar.');
    if (!(await CC.confirm('Replace everything here with the backup from ' + (p.at || 'an unknown date').slice(0, 10) + '?', 'Replace'))) return;
    D.items = p.data.items; D.notes = p.data.notes; if (Array.isArray(p.data.cats)) D.cats = p.data.cats; if (p.settings) Object.assign(S, p.settings);
    CC.save(); CC.saveS(); CC.applyLook(); R.tick(); CC.render(); CC.toast('Backup restored');
  }
  CC.views.settings = () => {
    const b = S.bg, perm = R.perm(), eg = D.items.some((i) => i.example) || D.notes.some((n) => n.example);
    const permText = { granted: 'Notifications are on for this browser.', denied: 'Notifications are blocked. Allow them for this page in your browser or phone settings.', default: 'Notifications are off. Turn them on to get a pop-up outside this page.', unsupported: 'This browser or window does not allow notifications. The reminder panel and sounds inside the calendar still work.' }[perm];
    return h('div', { class: 'dash fade-in' },
      card('Theme',
        h('div', { class: 'row', role: 'group', 'aria-label': 'Theme' }, [['midnight', 'Midnight purple', 'linear-gradient(135deg,#07060f,#2a1660 60%,#f5b352)', '#f4effc'], ['amber', 'Amber', 'linear-gradient(135deg,#0d0704,#6a3a10 55%,#ffdc8f)', '#fbefdc'], ['blush', 'Pink and off-white', 'linear-gradient(135deg,#fbf6f0,#f8dde7 55%,#e3759f)', '#48293a']].map((t) => h('button', { class: 'swatch', type: 'button', 'aria-pressed': String(S.look === t[0]), style: { background: t[2], color: t[3] }, onclick: () => setS(() => { S.look = t[0]; S.accent = ''; }) }, t[1]))),
        field('Highlight colour', h('div', { class: 'chips' }, ['', '#f5b352', '#ffd98a', '#e3759f', '#f6b9cd', '#b79bff', '#8fd3ff', '#8fe3c4'].map((a) => h('button', { class: 'sw', type: 'button', 'aria-label': a ? 'Colour ' + a : 'The theme\'s own colour', 'aria-pressed': String(S.accent === a), style: { background: a || 'var(--tint2)' }, onclick: () => setS(() => { S.accent = a; }) })), h('input', { type: 'color', id: 'set-accent', 'aria-label': 'Any colour', style: { width: '52px', padding: '3px' }, value: S.accent || '#f5b352', onchange: (e) => setS(() => { S.accent = e.target.value; }) }))),
        field('Font', CC.chipRow([['elegant', 'Elegant'], ['round', 'Rounded'], ['modern', 'Modern']], S.font, (v) => setS(() => { S.font = v; })))),
      card('Background',
        h('div', { class: 'row', role: 'group', 'aria-label': 'Background' }, [['luxe', 'Soft lighting', 'Calm glow in your theme colours. Easiest on the battery.'], ['clouds', 'Purple clouds', 'Your purple and amber nebula picture behind the calendar.'], ['lights', 'Northern lights', 'Green and violet aurora over the sea and mountains.'], ['photos', 'My pictures', 'A slideshow of your photos behind the calendar.']].map((x) => h('button', { class: 'exp ' + x[0], type: 'button', 'aria-pressed': String(b.exp === x[0]), onclick: () => setS(() => { b.exp = x[0]; }) }, h('b', { text: x[1] }), h('span', { text: x[2] })))),
        b.exp === 'photos' && h('p', { class: 'hint', text: CC.uploads.length ? 'Showing your ' + CC.uploads.length + ' photo' + (CC.uploads.length === 1 ? '' : 's') + ', one after another.' : 'You have not added photos yet, so the starter pictures are showing. Add yours under Photos below.' }),
        b.exp === 'photos' && slider('sl-secs', 'Each picture stays for', 5, 120, 5, b.secs, ' s', (v) => { b.secs = v; }),
        b.exp === 'photos' && slider('sl-fade', 'Fade between pictures', 0.4, 4, 0.2, b.fade, ' s', (v) => { b.fade = v; }),
        b.exp !== 'luxe' && slider('sl-blur', 'Blur', 0, 20, 1, b.blur, ' px', (v) => { b.blur = v; }),
        b.exp !== 'luxe' && slider('sl-bright', 'Brightness', 40, 130, 5, b.bright, '%', (v) => { b.bright = v; }),
        slider('sl-panel', 'How solid the panels are (lower shows more of the background)', 0, 100, 2, S.panel, '%', (v) => { S.panel = v; }),
        slider('sl-pblur', 'Frosting behind the panels', 0, 24, 1, S.pblur, ' px', (v) => { S.pblur = v; }),
        slider('sl-dim', 'Colour wash over the background (keeps text easy to read)', 0, 80, 2, b.dim, '%', (v) => { b.dim = v; }),
        field('Animation', CC.chipRow([['auto', 'Match my device'], ['full', 'Full'], ['subtle', 'Gentle'], ['off', 'Off']], S.motion, (v) => setS(() => { S.motion = v; }))),
        h('p', { class: 'hint', text: 'Gentle slows everything down. Off stops all movement.' })),
      card('Personal touches',
        h('div', { class: 'field' }, h('label', { for: 'set-name', text: 'Calendar name' }), h('input', { type: 'text', id: 'set-name', maxlength: '30', value: S.name, oninput: (e) => { S.name = e.target.value; CC.saveS(); $('#cal-name').textContent = S.name || 'My Calendar'; } })),
        h('div', { class: 'field' }, h('label', { for: 'set-done', text: 'Message when I complete something' }), h('input', { type: 'text', id: 'set-done', maxlength: '60', value: S.doneMsg, placeholder: 'Leave empty for no message', oninput: (e) => { S.doneMsg = e.target.value; CC.saveS(); } })),
        h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: (e) => CC.celebrate(e.clientX, e.clientY) }, 'Preview it')),
        field('Spacing', CC.chipRow([['cozy', 'Roomy'], ['compact', 'Compact']], S.density, (v) => setS(() => { S.density = v; }))),
        h('div', { class: 'two' }, field('Week starts on', CC.chipRow([[0, 'Sunday'], [1, 'Monday']], S.weekStart, (v) => setS(() => { S.weekStart = v; }))), field('Clock', CC.chipRow([[false, '12-hour'], [true, '24-hour']], S.h24, (v) => setS(() => { S.h24 = v; }))))),
      card('Photos',
        h('div', { class: 'row' }, h('button', { class: 'btn primary small', type: 'button', onclick: () => CC.pickFiles('image/*', async (f) => { await CC.addPhotos(f); CC.bg.apply(); CC.render(); }) }, 'Add your photos')),
        h('p', { class: 'hint', text: 'Pictures that are switched on appear on the month page and on each day, picked at random, and you can keep or choose one per day. The slideshow background uses your own photos. They are shrunk to save space and stay on this device.' }),
        CC.uploads.length ? h('div', { class: 'photos' }, CC.uploads.map((u) => h('div', { class: 'ph' }, h('img', { src: u.url, alt: 'Your photo' }), h('button', { class: 'on-photo', type: 'button', onclick: async () => { await CC.idb.del('photos', u.id); URL.revokeObjectURL(u.url); CC.uploads = CC.uploads.filter((x) => x.id !== u.id); CC.bg.apply(); CC.render(); CC.toast('Photo removed'); } }, 'Remove')))) : null,
        h('h3', { text: 'Starter pictures' }), h('div', { class: 'photos' }, CC.STARTERS.map((p) => { const off = S.hidden.includes(p.id); return h('div', { class: 'ph' }, h('img', { src: p.src, alt: p.name }), h('button', { class: 'on-photo', type: 'button', 'aria-pressed': String(!off), onclick: () => setS(() => { S.hidden = off ? S.hidden.filter((x) => x !== p.id) : S.hidden.concat(p.id); }) }, off ? 'Off' : 'On')); })),
        h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => setS(() => { S.hidden = S.hidden.length ? [] : CC.STARTERS.map((p) => p.id); }) }, S.hidden.length ? 'Turn all starter pictures on' : 'Turn all starter pictures off'))),
      card('Reminders',
        h('p', { class: perm === 'granted' ? 'okc' : 'warnc', text: permText }),
        h('div', { class: 'row' }, perm === 'default' && h('button', { class: 'btn primary small', type: 'button', onclick: async () => { await R.askPerm(); CC.render(); } }, 'Turn on notifications'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { R.play(); try { if (R.perm() === 'granted') new Notification('Test reminder', { body: 'This is how a reminder looks.' }); } catch (e) { /* not allowed */ } CC.toast('Test sent'); } }, 'Send a test')),
        h('p', { class: 'hint', text: 'Reminders, including "keep reminding until done", run while this calendar is open in a tab or on your home screen. When it is fully closed, a browser cannot wake it up by itself. Reaching a closed phone needs a small server sending push messages, which is not set up yet. On iPhone, pop-ups only work after adding the calendar to the home screen.' }),
        h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 'set-sound', text: 'Sound' }), CC.select('set-sound', R.SOUNDS, S.sound, (v) => { S.sound = v; CC.saveS(); R.play(v); })),
          slider('set-vol', 'Volume', 0, 100, 5, S.vol, '%', (v) => { S.vol = v; })),
        h('label', { class: 'cl-row' }, h('input', { type: 'checkbox', id: 'set-quiet', checked: S.quiet.on, onchange: (e) => setS(() => { S.quiet.on = e.target.checked; }) }), h('span', { text: 'Quiet hours (no sound or pop-up, except high priority)' })),
        S.quiet.on && h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 'set-qf', text: 'From' }), h('input', { type: 'time', id: 'set-qf', value: S.quiet.from, onchange: (e) => { S.quiet.from = e.target.value || '22:00'; CC.saveS(); } })), h('div', { class: 'field' }, h('label', { for: 'set-qt', text: 'Until' }), h('input', { type: 'time', id: 'set-qt', value: S.quiet.to, onchange: (e) => { S.quiet.to = e.target.value || '07:00'; CC.saveS(); } }))),
        h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 'set-allday', text: 'Remind at this time when an item has no time' }), h('input', { type: 'time', id: 'set-allday', value: S.allDayAt, onchange: (e) => { S.allDayAt = e.target.value || '09:00'; CC.saveS(); R.tick(); } })),
          h('div', { class: 'field' }, h('label', { for: 'set-nag', text: 'New items keep reminding every (min, 0 = off)' }), h('input', { type: 'number', id: 'set-nag', min: '0', value: S.defNag, onchange: (e) => { S.defNag = Math.max(0, +e.target.value || 0); CC.saveS(); } }))),
        field('New items start with these reminders', h('div', { class: 'chips' }, R.PRESETS.map((p) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.defRems.includes(p[0])), onclick: () => setS(() => { S.defRems = S.defRems.includes(p[0]) ? S.defRems.filter((x) => x !== p[0]) : S.defRems.concat(p[0]); }) }, p[1]))))),
      card('Categories',
        D.cats.map((c) => h('div', { class: 'cl-row' }, h('input', { type: 'color', 'aria-label': 'Colour for ' + c.name, value: c.color, style: { width: '44px', padding: '2px' }, onchange: (e) => { c.color = e.target.value; CC.save(); CC.render(); } }), h('input', { type: 'text', 'aria-label': 'Category name', id: 'cat-' + c.id, maxlength: '24', value: c.name, oninput: (e) => { c.name = e.target.value; CC.save(); } }),
          h('button', { class: 'ib', type: 'button', 'aria-label': 'Delete category ' + c.name, onclick: async () => { if (await CC.confirm('Delete the category "' + c.name + '"? Items keep existing without a category.', 'Delete', true)) { D.cats = D.cats.filter((x) => x !== c); CC.save(); CC.render(); } } }, CC.icon('x')))),
        h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => { D.cats.push({ id: CC.uid(), name: 'New category', color: '#8fd3ff' }); CC.save(); CC.render(); } }, 'Add category'))),
      card('Planning',
        h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 'set-df', text: 'My day starts at (hour)' }), h('input', { type: 'number', id: 'set-df', min: '0', max: '23', value: S.dayFrom, onchange: (e) => setS(() => { S.dayFrom = Math.max(0, Math.min(S.dayTo - 1, +e.target.value || 0)); }) })), h('div', { class: 'field' }, h('label', { for: 'set-dt', text: 'and ends at (hour)' }), h('input', { type: 'number', id: 'set-dt', min: '1', max: '24', value: S.dayTo, onchange: (e) => setS(() => { S.dayTo = Math.max(S.dayFrom + 1, Math.min(24, +e.target.value || 24)); }) }))),
        h('p', { class: 'hint', text: 'Free time and suggested slots are worked out inside these hours.' })),
      card('Google Calendar', h('p', { class: 'hint', text: 'Not connected yet. Everything you add is saved on this device only, and nothing is sent to Google. Connecting needs the calendar to live at its own web address, which is the next stage.' })),
      card('Backup',
        h('p', { class: 'hint', text: 'A backup holds your items, notes, categories and settings. Photos and attached files are not included.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: async () => { const t = backup(); try { await navigator.clipboard.writeText(t); CC.toast('Backup copied. Paste it somewhere safe.'); } catch (e) { $('#bk-in').value = t; $('#bk-in').select(); CC.toast('Copy the text in the box below.'); } } }, 'Copy backup'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([backup()], { type: 'application/json' })), download: 'calendar-backup-' + CC.today() + '.json' }); document.body.append(a); a.click(); a.remove(); CC.toast('If no file was saved, use Copy backup instead.'); } }, 'Save backup file'),
          h('button', { class: 'btn small', type: 'button', onclick: () => CC.pickFiles('.json,application/json', async (f) => { if (f[0]) restore(await f[0].text()); }) }, 'Restore from a file')),
        h('div', { class: 'field' }, h('label', { for: 'bk-in', text: 'Or paste a backup here' }), h('textarea', { id: 'bk-in', rows: '2' })),
        h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => { const v = $('#bk-in').value.trim(); if (v) restore(v); else CC.toast('Paste a backup into the box first.'); } }, 'Restore pasted backup'))),
      card('Keyboard shortcuts', h('div', { class: 'col', style: { gap: '6px' } }, [['N', 'Add something'], ['/', 'Search'], ['T', 'Go to today'], ['D W M Y', 'Day, week, month, year'], ['A', 'Agenda'], ['← →', 'Previous and next (or swipe on a phone)'], ['Esc', 'Close']].map((k) => h('div', { class: 'row' }, h('kbd', { text: k[0] }), k[1]))),
        eg && h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => { D.items = D.items.filter((i) => !i.example); D.notes = D.notes.filter((n) => !n.example); CC.save(); R.tick(); CC.render(); CC.toast('Examples removed'); } }, 'Remove the example items'))));
  };
})(window.CC);
