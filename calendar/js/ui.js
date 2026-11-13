/* UI plumbing: toasts, sheets, confirm, menus, the completion moment, and the two background experiences. */
(function (CC) {
  'use strict';
  const { $, h, S } = CC;
  CC.ui = { view: 'cal', sel: CC.today(), dir: '', dayShown: null, agenda: 'up', notesTab: 'active', noteCat: '', noteQ: '', trayOpen: false, focus: false };

  let toastT = 0;
  CC.toast = (msg) => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); };
  CC.closeModal = () => { const m = $('#modal'); m.classList.remove('open'); m.replaceChildren(); };
  CC.openModal = (sheet) => { const m = $('#modal'); m.replaceChildren(sheet); m.classList.add('open'); };
  CC.sheet = (title, ...kids) => h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'ib', type: 'button', 'aria-label': 'Close', onclick: CC.closeModal }, CC.icon('x'))), kids);
  /** In-page yes/no question (browser confirm boxes are not available here). */
  CC.confirm = (msg, okLabel, danger) => new Promise((res) => {
    const c = $('#confirm'), done = (v) => { c.classList.remove('open'); c.replaceChildren(); res(v); };
    c.replaceChildren(h('div', { class: 'sheet', role: 'alertdialog', 'aria-label': msg, style: { 'max-width': '400px' } }, h('p', { text: msg }),
      h('div', { class: 'row between' }, h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'Keep it'), h('button', { class: 'btn primary' + (danger ? ' danger' : ''), type: 'button', id: 'confirm-ok', onclick: () => done(true) }, okLabel || 'Yes'))));
    c.classList.add('open'); $('#confirm-ok').focus();
  });
  CC.ask = (label, def, type) => new Promise((res) => {
    const c = $('#confirm'), done = (v) => { c.classList.remove('open'); c.replaceChildren(); res(v); };
    c.replaceChildren(h('form', { class: 'sheet', style: { 'max-width': '400px' }, onsubmit: (e) => { e.preventDefault(); done($('#ask-in').value); } },
      h('div', { class: 'field' }, h('label', { for: 'ask-in', text: label }), h('input', { type: type || 'text', id: 'ask-in', value: def == null ? '' : def })),
      h('div', { class: 'row between' }, h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'OK'))));
    c.classList.add('open'); $('#ask-in').focus();
  });
  CC.menu = (x, y, items) => {
    const m = $('#menu'); m.hidden = false;
    m.replaceChildren(...items.filter(Boolean).map((it) => h('button', { type: 'button', class: it.danger ? 'late' : '', onclick: () => { m.hidden = true; it.fn(); } }, it.label)));
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    const b = m.querySelector('button'); if (b) b.focus();
  };
  document.addEventListener('pointerdown', (e) => { const m = $('#menu'); if (m && !m.hidden && !m.contains(e.target)) m.hidden = true; }, true);

  CC.motion = () => S.motion !== 'auto' ? S.motion : (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'full');
  CC.isMobile = () => matchMedia('(max-width: 999px), (pointer: coarse)').matches;

  // ---------- the completion moment: amber and violet burst, then the personal message ----------
  let cheerT = 0;
  CC.celebrate = (x, y) => {
    const m = CC.motion(), cx = x || innerWidth / 2, cy = y || innerHeight * .4;
    if (m !== 'off' && document.body.animate) {
      const cols = ['#f5b352', '#ffd98a', '#8b6cff', '#c9b6ff', '#ffffff'], n = m === 'full' ? 26 : 12;
      for (let i = 0; i < n; i++) {
        const s = h('i', { class: 'spark', style: { left: cx + 'px', top: cy + 'px', background: cols[i % cols.length], 'box-shadow': '0 0 10px ' + cols[i % cols.length] } }); document.body.append(s);
        const a = Math.PI * 2 * i / n + Math.random() * .5, d = 50 + Math.random() * 90, sz = .5 + Math.random() * 1.1;
        s.animate([{ transform: 'translate(-50%,-50%) scale(' + sz + ')', opacity: 1 }, { transform: 'translate(' + (Math.cos(a) * d - 4) + 'px,' + (Math.sin(a) * d + 30) + 'px) scale(.1)', opacity: 0 }], { duration: 750 + Math.random() * 450, easing: 'cubic-bezier(.15,.8,.3,1)' }).onfinish = () => s.remove();
      }
    }
    const el = $('#cheer'), msg = (S.doneMsg || '').trim(); if (!el || !msg) return;
    el.textContent = msg; el.hidden = false; clearTimeout(cheerT);
    if (m !== 'off' && el.animate) {
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([{ opacity: 0, transform: 'translate(-50%,-30%) scale(.9)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .18 }, { opacity: 1, transform: 'translate(-50%,-58%) scale(1.02)', offset: .72 }, { opacity: 0, transform: 'translate(-50%,-78%) scale(1.04)' }], { duration: 2600, easing: 'ease-out' }).onfinish = () => { el.hidden = true; };
    } else cheerT = setTimeout(() => { el.hidden = true; }, 2000);
  };
  CC.sparks = CC.celebrate;

  CC.applyLook = () => {
    const r = document.documentElement;
    r.setAttribute('data-density', S.density); r.setAttribute('data-motion', CC.motion()); r.setAttribute('data-exp', S.bg.exp);
    CC.bg.apply();
  };

  // ---------- backgrounds: Midnight Luxury (light 2D lighting) and Cosmic Universe (3D) ----------
  const par = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { par.x = e.clientX / innerWidth * 2 - 1; par.y = e.clientY / innerHeight * 2 - 1; } }, { passive: true });
  const STARS = Array.from({ length: 130 }, () => ({ x: Math.random(), y: Math.random(), z: .3 + Math.random() * .7, sp: .4 + Math.random() * 1.4, ph: Math.random() * 6 }));
  const glow = (c, x, y, r, rgb, a) => { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); };
  function luxe(c, w, hg, t, p, starry) {
    const g = c.createLinearGradient(0, 0, 0, hg); g.addColorStop(0, '#0b0820'); g.addColorStop(.55, '#0a0719'); g.addColorStop(1, '#06050d'); c.fillStyle = g; c.fillRect(0, 0, w, hg);
    const m = Math.max(w, hg);
    glow(c, w * (.18 + .05 * Math.sin(t * .05)) + p.x * 12, hg * .1, m * .75, '91,59,214', .34);
    glow(c, w * (.9 + .04 * Math.cos(t * .04)) - p.x * 10, hg * .5, m * .6, '27,42,140', .34);
    glow(c, w * (.55 + .08 * Math.sin(t * .03 + 2)), hg * 1.08, m * .55, '245,179,82', .13);
    c.fillStyle = '#efe9ff';
    for (const s of STARS) { c.globalAlpha = (starry ? .9 : .5) * (.25 + .75 * Math.abs(Math.sin(t * s.sp * .6 + s.ph))); c.beginPath(); c.arc(s.x * w + p.x * s.z * 10, s.y * hg + p.y * s.z * 6, s.z * (starry ? 1.7 : 1.2), 0, 7); c.fill(); }
    c.globalAlpha = 1;
  }
  let raf = 0, lastT = 0, world = null, loading = false, glFailed = false;
  function size2d() { const c = $('#bg-c'), k = Math.min(1.25, devicePixelRatio || 1); c.width = Math.round(innerWidth * k); c.height = Math.round(innerHeight * k); }
  function frame(ts) {
    raf = 0; if (document.hidden) return;
    const m = CC.motion(), cosmic = S.bg.exp === 'cosmic' && world, gap = cosmic ? (CC.isMobile() ? 33 : 22) : 60;
    if (ts - lastT >= gap) {
      lastT = ts; const t = m === 'off' ? 40 : ts / 1000 * (m === 'subtle' ? .5 : 1);
      if (cosmic) world.frame(t, m); else { const c = $('#bg-c'); luxe(c.getContext('2d'), c.width, c.height, t, m === 'full' ? par : { x: 0, y: 0 }, S.bg.exp === 'cosmic'); }
    }
    if (m !== 'off') raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); } };
  function startWorld() {
    if (world || loading || glFailed) return;
    loading = true;
    new Promise((res, rej) => { if (window.THREE) return res(); const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'; s.onload = res; s.onerror = rej; document.head.append(s); })
      .then(() => { world = CC.cosmos($('#bg-gl'), CC.isMobile(), () => par); world.resize(); })
      .catch(() => { glFailed = true; })
      .then(() => { loading = false; CC.bg.apply(); if (CC.ui.view === 'settings') CC.render(); });
  }
  CC.bg = {
    failed: () => glFailed,
    apply() {
      const c2 = $('#bg-c'), gl = $('#bg-gl'); if (!c2) return;
      const cosmic = S.bg.exp === 'cosmic';
      if (cosmic && !world) startWorld();
      const live = cosmic && !!world;
      gl.hidden = !live; c2.hidden = live; if (!live) size2d();
      $('#bg-dim').style.opacity = S.bg.dim / 100;
      cancelAnimationFrame(raf); raf = 0; kick();
    }
  };
  addEventListener('resize', () => { if (world) world.resize(); size2d(); kick(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
})(window.CC);
