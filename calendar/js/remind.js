/* Reminders: several per item, and optional repeat-until-done. Runs while the calendar is open in a tab or on the home screen. */
(function (CC) {
  'use strict';
  const { $, h, S } = CC;
  const R = CC.R = { ringing: [] };
  R.PRESETS = [[0, 'At the time'], [5, '5 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [120, '2 hours before'], [360, '6 hours before'], [720, '12 hours before'], [1440, '1 day before'], [2880, '2 days before'], [10080, '1 week before']];
  R.label = (r) => { if (r.at) return new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); const p = R.PRESETS.find((x) => x[0] === r.m); if (p) return p[1]; return (r.m % 1440 === 0 ? r.m / 1440 + ' days' : r.m % 60 === 0 ? r.m / 60 + ' hours' : r.m + ' min') + ' before'; };
  const fireTimes = (o) => { const s = CC.startOf(o).getTime(); return (o.it.rems || []).map((r) => r.at ? new Date(r.at).getTime() : s - r.m * 6e4).filter((t) => !isNaN(t)).sort((a, b) => a - b); };
  R.rel = (ms) => { const m = Math.round(Math.abs(ms) / 6e4), t = m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' days'; return ms >= 0 ? 'in ' + t : t + ' ago'; };

  // ---------- sound ----------
  let actx = null;
  const TONES = { chime: [[880, 0, .5], [1318, .18, .7]], bell: [[660, 0, 1.3], [1320, 0, .9], [1980, 0, .5]], pulse: [[520, 0, .12], [520, .22, .12], [520, .44, .12]], soft: [[440, 0, .7], [554, .25, .7], [659, .5, 1]], bright: [[1046, 0, .2], [1318, .12, .2], [1568, .24, .5]] };
  R.SOUNDS = [['chime', 'Chime'], ['bell', 'Bell'], ['pulse', 'Pulse'], ['soft', 'Soft rise'], ['bright', 'Bright'], ['none', 'Silent']];
  R.play = (name) => {
    const tones = TONES[name || S.sound]; if (!tones) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime + .02, vol = S.vol / 100 * .35;
      for (const [f, at, len] of tones) { const o = actx.createOscillator(), g = actx.createGain(); o.type = name === 'pulse' ? 'triangle' : 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(Math.max(vol, .001), t0 + at + .02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len); o.connect(g).connect(actx.destination); o.start(t0 + at); o.stop(t0 + at + len + .05); }
    } catch (e) { /* sound is blocked until the first tap */ }
  };
  document.addEventListener('pointerdown', () => { try { if (actx && actx.state === 'suspended') actx.resume(); } catch (e) { /* ignore */ } }, { passive: true });

  // ---------- system notifications ----------
  R.perm = () => { try { return 'Notification' in window ? Notification.permission : 'unsupported'; } catch (e) { return 'unsupported'; } };
  R.askPerm = async () => { try { if (!('Notification' in window)) return 'unsupported'; return await Notification.requestPermission(); } catch (e) { return 'denied'; } };
  function sysNotify(title, body, tag) { try { if (R.perm() === 'granted') { const n = new Notification(title, { body, tag, renotify: true }); n.onclick = () => { window.focus(); n.close(); }; return true; } } catch (e) { /* not allowed here */ } return false; }
  const inQuiet = () => { if (!S.quiet.on) return false; const n = new Date(), m = n.getHours() * 60 + n.getMinutes(), a = CC.toMin(S.quiet.from), b = CC.toMin(S.quiet.to); return a <= b ? m >= a && m < b : m >= a || m < b; };

  // ---------- the clock ----------
  R.tick = () => {
    const now = Date.now(), A = CC.alerts, ring = [], fresh = [];
    for (const o of CC.occs(CC.shift(CC.today(), -7), CC.shift(CC.today(), 32))) {
      if (o.st !== 'active' || o.it.archived) continue;
      const ft = fireTimes(o); if (!ft.length && !o.it.nag) continue;
      const s = CC.startOf(o).getTime(), nagStart = o.it.nagFrom === 'first' && ft.length ? ft[0] : s, nagging = o.it.nag > 0 && now >= nagStart, due = ft.filter((t) => t <= now);
      if (!due.length && !nagging) continue;
      const a = A[o.key] || (A[o.key] = { f: [], last: 0, sn: 0, ack: 0 }), snoozed = now < a.sn, news = due.filter((t) => !a.f.includes(t));
      if (news.length) a.f.push(...news);
      if (!snoozed && (news.length || a.resn || (nagging && now - a.last >= o.it.nag * 6e4))) { fresh.push(o); a.last = now; a.resn = false; }
      if (!snoozed && (nagging || due.some((t) => t > a.ack))) ring.push(Object.assign(o, { nagging, start: s }));
    }
    ring.sort((x, y) => x.start - y.start); R.ringing = ring;
    if (fresh.length) {
      CC.saveAlerts(); CC.ui.trayOpen = true;
      const loud = fresh.filter((o) => !inQuiet() || o.it.prio === 'high');
      if (loud.length) { R.play(); for (const o of loud) sysNotify(o.it.title, (o.time ? CC.fmtTime(o.time) + ' · ' : '') + CC.longDate(o.date) + (o.nagging ? ' · tick it done to stop reminders' : ''), o.key); }
    }
    document.title = (ring.length ? '(' + ring.length + ') ' : '') + (S.name || 'My Calendar');
    R.render();
  };
  const st = (o) => CC.alerts[o.key] || (CC.alerts[o.key] = { f: [], last: 0, sn: 0, ack: 0 });
  R.snooze = (o, mins) => { const a = st(o); a.sn = Date.now() + mins * 6e4; a.resn = true; CC.saveAlerts(); CC.toast('Snoozed for ' + CC.fmtDur(mins)); R.tick(); };
  R.dismiss = (o) => { st(o).ack = Date.now(); CC.saveAlerts(); R.tick(); };
  R.done = (o, ev) => { CC.setStatus(o, 'done'); if (ev) CC.sparks(ev.clientX, ev.clientY); CC.toast('Done'); R.tick(); CC.render(); };
  R.postpone = (o, date, time) => { CC.move(o, date, time); CC.toast('Moved to ' + CC.shortDate(date) + (time ? ', ' + CC.fmtTime(time) : '')); R.tick(); CC.render(); };
  R.menu = (o, ev) => {
    const plus = (m) => { const d = new Date(CC.startOf(o).getTime() + m * 6e4); return [CC.ymd(d), o.time ? CC.pad(d.getHours()) + ':' + CC.pad(d.getMinutes()) : '']; };
    const r = ev.currentTarget.getBoundingClientRect();
    CC.menu(r.left, r.bottom + 4, [
      { label: 'Postpone 1 hour', fn: () => R.postpone(o, ...plus(60)) },
      { label: 'Postpone to tomorrow', fn: () => R.postpone(o, CC.shift(o.date < CC.today() ? CC.today() : o.date, 1), o.time) },
      { label: 'Pick a new date and time', fn: () => CC.openEditor(o) },
      { label: 'Mark as missed', fn: () => { CC.setStatus(o, 'missed'); R.tick(); CC.render(); } },
      { label: 'Cancel it', danger: true, fn: () => { CC.setStatus(o, 'canceled'); CC.toast('Canceled'); R.tick(); CC.render(); } },
      !o.nagging && { label: 'Dismiss this reminder', fn: () => R.dismiss(o) }
    ]);
  };
  R.snoozeMenu = (o, ev) => {
    const r = ev.currentTarget.getBoundingClientRect(), tm = new Date(); tm.setDate(tm.getDate() + 1); tm.setHours(9, 0, 0, 0);
    CC.menu(r.left, r.bottom + 4, [[5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour'], [180, '3 hours']].map((x) => ({ label: x[1], fn: () => R.snooze(o, x[0]) })).concat([
      { label: 'Until tomorrow, 9:00', fn: () => R.snooze(o, Math.round((tm - Date.now()) / 6e4)) },
      { label: 'Custom…', fn: async () => { const v = await CC.ask('Snooze for how many minutes?', 20, 'number'); if (v && +v > 0) R.snooze(o, +v); } }]));
  };
  R.render = () => {
    const b = $('#bell-badge'); if (b) { b.hidden = !R.ringing.length; b.textContent = R.ringing.length; }
    const t = $('#tray'); if (!t) return;
    if (!CC.ui.trayOpen || !R.ringing.length) { t.hidden = true; return; }
    t.hidden = false;
    CC.fill(t, h('div', { class: 'row between' }, h('h3', { text: 'Reminders' }), h('button', { class: 'btn small', type: 'button', onclick: () => { CC.ui.trayOpen = false; R.render(); } }, 'Hide')),
      ...R.ringing.map((o) => h('div', { class: 'ringrow' + (o.nagging ? ' hot' : ''), style: { '--c': CC.colorOf(o.it) || 'var(--accent)' } },
        h('div', {}, h('b', { text: o.it.title }), h('div', { class: 'item-meta' }, (o.start > Date.now() ? 'Starts ' : o.it.kind === 'task' ? 'Due ' : 'Started ') + R.rel(o.start - Date.now()), o.it.prio === 'high' && h('span', { class: 'prio-high', text: 'High priority' }), o.nagging && h('span', { text: 'Repeats every ' + CC.fmtDur(o.it.nag) + ' until done' }))),
        h('div', { class: 'row' }, h('button', { class: 'btn small primary', type: 'button', onclick: (e) => R.done(o, e) }, '✓ Done'), h('button', { class: 'btn small', type: 'button', onclick: (e) => R.snoozeMenu(o, e) }, 'Snooze'), h('button', { class: 'btn small', type: 'button', onclick: (e) => R.menu(o, e) }, 'More')))));
  };
  R.start = () => { const cut = CC.shift(CC.today(), -40); for (const k in CC.alerts) if ((k.split('@')[1] || '') < cut) delete CC.alerts[k]; R.tick(); setInterval(R.tick, 15000); document.addEventListener('visibilitychange', () => { if (!document.hidden) R.tick(); }); };
})(window.CC);
