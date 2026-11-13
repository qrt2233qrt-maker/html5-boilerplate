/* App shell: navigation, top bar, rendering, keyboard shortcuts and start-up. */
(function (CC) {
  'use strict';
  const { $, h, S, ui, R } = CC;
  const NAV = [['cal', 'Calendar', 'cal'], ['agenda', 'Agenda', 'list'], ['tasks', 'Tasks', 'check'], ['notes', 'Notes', 'note'], ['focus', 'Today', 'timer'], ['settings', 'Settings', 'sliders']];
  const go = (v) => { ui.view = v; ui.dir = 'fade-in'; CC.render(); window.scrollTo(0, 0); };

  CC.render = () => {
    const view = $('#view'), act = document.activeElement; let keep = null;
    if (act && act.id && view.contains(act)) { keep = { id: act.id }; try { keep.s = act.selectionStart; keep.e = act.selectionEnd; } catch (e) { /* not a text field */ } }
    $('#nav').replaceChildren(...NAV.map((n) => h('button', { type: 'button', 'aria-pressed': String(ui.view === n[0]), onclick: () => go(n[0]) }, CC.icon(n[2]), n[1])));
    $('#bar').replaceChildren(h('h1', { id: 'cal-name', text: S.name || 'My Calendar' }),
      h('button', { class: 'pill', type: 'button', title: 'Saved on this device. Google Calendar is not connected.', onclick: () => go('settings') }, 'This device only'),
      h('button', { class: 'ib', type: 'button', 'aria-label': 'Search', onclick: CC.openSearch }, CC.icon('search')),
      h('button', { class: 'ib', type: 'button', 'aria-label': 'Reminders', onclick: () => { if (!R.ringing.length) return CC.toast('No reminders are waiting.'); ui.trayOpen = !ui.trayOpen; R.render(); } }, CC.icon('bell'), h('span', { class: 'badge', id: 'bell-badge', hidden: true })),
      h('button', { class: 'ib primary', type: 'button', 'aria-label': 'Add something', onclick: () => CC.openEditor(null, ui.view === 'tasks' ? { kind: 'task' } : null) }, CC.icon('plus')));
    view.replaceChildren(...[].concat(CC.views[ui.view]()).filter(Boolean));
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch (e) { /* not a text field */ } } }
    ui.dir = ''; R.render(); CC.renderFocus();
  };

  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') CC.closeModal(); });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName), modal = $('#modal').classList.contains('open'), conf = $('#confirm').classList.contains('open');
    if (e.key === 'Escape') {
      if (!$('#menu').hidden) $('#menu').hidden = true; else if (conf) { const b = $('#confirm .btn'); if (b) b.click(); }
      else if (modal) CC.closeModal(); else if (ui.focus) { ui.focus = false; CC.render(); } else if (ui.trayOpen) { ui.trayOpen = false; R.render(); }
      return;
    }
    if (typing || modal || conf || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); CC.openEditor(null); } else if (k === '/') { e.preventDefault(); CC.openSearch(); }
    else if (k === 't') { ui.sel = CC.today(); ui.dayShown = null; go('cal'); } else if (k === 'a') go('agenda');
    else if ({ d: 'day', w: 'week', m: 'month', y: 'year' }[k]) CC.setCal({ d: 'day', w: 'week', m: 'month', y: 'year' }[k]);
    else if (ui.view === 'cal' && e.key === 'ArrowLeft') CC.step(-1); else if (ui.view === 'cal' && e.key === 'ArrowRight') CC.step(1);
  });

  CC.applyLook(); CC.render(); R.start();
  CC.idb.open().then(() => CC.idb.all('photos')).then((recs) => {
    CC.uploads = (recs || []).filter((r) => r && r.blob).map((r) => ({ id: r.id, url: URL.createObjectURL(r.blob) }));
    if (CC.uploads.length) { CC.bg.apply(); CC.render(); }
  });
  const sp = $('#splash'); if (sp) { sp.style.opacity = 0; setTimeout(() => sp.remove(), 450); }
})(window.CC);
