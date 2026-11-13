/* UI plumbing: toasts, sheets, confirm, menus, themes and the living backdrop. */
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
    c.replaceChildren(h('div', { class: 'sheet', role: 'alertdialog', 'aria-label': msg, style: { 'max-width': '380px' } }, h('p', { text: msg }),
      h('div', { class: 'row between' }, h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'Keep it'), h('button', { class: 'btn primary' + (danger ? ' danger' : ''), type: 'button', id: 'confirm-ok', onclick: () => done(true) }, okLabel || 'Yes'))));
    c.classList.add('open'); $('#confirm-ok').focus();
  });
  CC.ask = (label, def, type) => new Promise((res) => {
    const c = $('#confirm'), done = (v) => { c.classList.remove('open'); c.replaceChildren(); res(v); };
    c.replaceChildren(h('form', { class: 'sheet', style: { 'max-width': '380px' }, onsubmit: (e) => { e.preventDefault(); done($('#ask-in').value); } },
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
  /** A little burst of colour where something was ticked off. */
  CC.sparks = (x, y) => {
    if (CC.motion() === 'off' || !document.body.animate) return;
    const cs = getComputedStyle(document.documentElement), cols = [cs.getPropertyValue('--accent'), cs.getPropertyValue('--accent2'), cs.getPropertyValue('--ok')];
    for (let i = 0; i < 16; i++) {
      const s = h('i', { class: 'spark', style: { left: x + 'px', top: y + 'px', background: cols[i % 3] } }); document.body.append(s);
      const a = Math.PI * 2 * i / 16 + Math.random() * .4, d = 40 + Math.random() * 50;
      s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: 'translate(' + (Math.cos(a) * d - 4) + 'px,' + (Math.sin(a) * d + 24) + 'px) rotate(' + (a * 160) + 'deg) scale(.2)', opacity: 0 }], { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => s.remove();
    }
  };

  CC.applyLook = () => {
    const r = document.documentElement;
    if (S.look === 'auto') r.removeAttribute('data-look'); else r.setAttribute('data-look', S.look);
    r.setAttribute('data-font', S.font); r.setAttribute('data-density', S.density); r.setAttribute('data-motion', CC.motion());
    if (S.accent) r.style.setProperty('--accent', S.accent); else r.style.removeProperty('--accent');
    CC.bg.apply();
  };

  // ---------- backdrop ----------
  const hexA = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim()); if (!m) return 'rgba(160,160,220,' + a + ')'; const n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };
  const rnd = (n, f) => Array.from({ length: n }, f);
  const STARS = rnd(150, () => ({ x: Math.random(), y: Math.random(), z: .3 + Math.random() * .7, sp: .5 + Math.random() * 1.5, ph: Math.random() * 6 }));
  const ORBS = rnd(20, () => ({ x: Math.random(), z: .25 + Math.random() * .75, sp: .4 + Math.random(), ph: Math.random() }));
  const lin = (c, hgt, a, b) => { const g = c.createLinearGradient(0, 0, 0, hgt); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  const glow = (c, x, y, r, col, a) => { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0)); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); };
  const SCENES = {
    aurora(c, w, hg, t, p, P) { c.fillStyle = lin(c, hg, P.bg, P.bg2); c.fillRect(0, 0, w, hg); for (let i = 0; i < 5; i++) glow(c, w * (.5 + .42 * Math.sin(t * .07 * (i + 1) + i * 2)) + p.x * 14 * (i + 1), hg * (.5 + .4 * Math.cos(t * .05 * (i + 2) + i)) + p.y * 10, Math.max(w, hg) * (.34 + .07 * (i % 3)), i % 2 ? P.a : P.a2, .42); },
    orbs(c, w, hg, t, p, P) { c.fillStyle = lin(c, hg, P.bg, P.bg2); c.fillRect(0, 0, w, hg); for (const o of ORBS) { const y = (1 - ((t * o.sp * .02 + o.ph) % 1)) * (hg + 240) - 120; glow(c, o.x * w + Math.sin(t * .3 + o.ph * 6) * 24 + p.x * o.z * 44, y + p.y * o.z * 26, 14 + o.z * 60, o.ph > .5 ? P.a : P.a2, .2 + .35 * o.z); } },
    stars(c, w, hg, t, p) { c.fillStyle = lin(c, hg, '#070b24', '#2b1a4d'); c.fillRect(0, 0, w, hg); glow(c, w * .8, hg * .2, Math.min(w, hg) * .5, '#8f7bff', .28); c.fillStyle = '#fff8e0'; for (const s of STARS) { c.globalAlpha = .3 + .7 * Math.abs(Math.sin(t * s.sp + s.ph)); c.beginPath(); c.arc(((s.x * w + p.x * s.z * 22 + t * s.z * 2) % w + w) % w, s.y * hg + p.y * s.z * 12, s.z * 1.6, 0, 7); c.fill(); } c.globalAlpha = 1; },
    ocean(c, w, hg, t, p) { c.fillStyle = lin(c, hg * .6, '#ffd9c2', '#9fd3ee'); c.fillRect(0, 0, w, hg); glow(c, w * .7 + p.x * 8, hg * .36, 150, '#fff3c9', .9); const cols = ['#9fd8ef', '#6fbfe3', '#4aa3d4', '#2f86bd', '#1f6a9f', '#154f7c']; for (let i = 0; i < 6; i++) { const y0 = hg * (.5 + i * .09); c.fillStyle = cols[i]; c.beginPath(); c.moveTo(0, hg); for (let x = 0; x <= w + 20; x += 20) c.lineTo(x, y0 + Math.sin(x * .008 * (1 + i * .2) + t * (.5 + i * .15) + i + p.x * .3) * (8 + i * 3)); c.lineTo(w, hg); c.fill(); } },
    peaks(c, w, hg, t, p) { c.fillStyle = lin(c, hg * .8, '#2b2148', '#f59a8b'); c.fillRect(0, 0, w, hg); glow(c, w * .5 + p.x * 6, hg * .56, 190, '#ffd9a0', .95); const cols = ['#6d4c7d', '#553a6b', '#402b58', '#2e1f45', '#1f1533']; for (let i = 0; i < 5; i++) { const base = hg * (.58 + i * .09), amp = hg * (.2 - i * .022), ox = p.x * (i + 1) * 7 + t * (i + 1) * 1.5; c.fillStyle = cols[i]; c.beginPath(); c.moveTo(0, hg); for (let x = 0; x <= w + 16; x += 16) { const u = (x + ox) * (i + 1); c.lineTo(x, base - (Math.sin(u * .004 + i * 5) * .5 + Math.sin(u * .011 + i) * .3 + .5) * amp); } c.lineTo(w, hg); c.fill(); } }
  };
  CC.SCENES = [['aurora', 'Aurora'], ['orbs', 'Floating lights'], ['stars', 'Night sky'], ['ocean', 'Ocean'], ['peaks', 'Mountains']];
  const par = { x: 0, y: 0 }; let raf = 0, lastT = 0, slideT = 0, slideI = 0, flip = false, pal = null;
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { par.x = e.clientX / innerWidth * 2 - 1; par.y = e.clientY / innerHeight * 2 - 1; } }, { passive: true });
  function size() { const c = $('#bg-c'), k = Math.min(1.5, devicePixelRatio || 1, 1400 / Math.max(innerWidth, 1)); c.width = Math.round(innerWidth * k); c.height = Math.round(innerHeight * k); }
  function draw(t) {
    const c = $('#bg-c'), ctx = c.getContext('2d'), m = CC.motion();
    if (!pal) { const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim(); pal = { bg: g('--bg'), bg2: g('--bg2'), a: g('--accent'), a2: g('--accent2') }; }
    (SCENES[S.bg.scene] || SCENES.aurora)(ctx, c.width, c.height, m === 'off' ? 3 : t * (m === 'subtle' ? .4 : 1), m === 'full' ? par : { x: 0, y: 0 }, pal);
  }
  function frame(ts) { raf = 0; if (S.bg.mode !== 'scene' || document.hidden) return; if (ts - lastT > 33) { lastT = ts; draw(ts / 1000); } if (CC.motion() !== 'off') raf = requestAnimationFrame(frame); }
  function slides() { const u = CC.uploads.map((x) => x.id); return u.length ? u : CC.pool(); }
  function showSlide() { const l = slides(); if (!l.length) return; const els = document.querySelectorAll('.bg-ph'), el = els[flip ? 1 : 0], other = els[flip ? 0 : 1]; el.style.backgroundImage = 'url("' + CC.srcOf(l[slideI % l.length]) + '")'; el.classList.add('on'); other.classList.remove('on'); flip = !flip; slideI++; }
  CC.bg = {
    apply() {
      const b = S.bg, media = $('#bg-media'), c = $('#bg-c'); if (!c) return;
      pal = null; clearInterval(slideT); cancelAnimationFrame(raf); raf = 0;
      const f = 'blur(' + b.blur + 'px) brightness(' + b.bright + '%)';
      media.style.filter = f; c.style.filter = f; media.style.setProperty('--fade', b.fade + 's');
      media.hidden = b.mode !== 'photos'; c.hidden = b.mode !== 'scene';
      $('#bg-dim').style.opacity = b.mode === 'theme' ? 0 : b.dim / 100;
      if (b.mode === 'scene') { size(); lastT = 0; requestAnimationFrame(frame); }
      if (b.mode === 'photos') { showSlide(); if (slides().length > 1) slideT = setInterval(showSlide, Math.max(4, b.secs) * 1000); }
    }
  };
  window.addEventListener('resize', () => { if (S.bg.mode === 'scene') { size(); if (!raf) requestAnimationFrame(frame); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.bg.mode === 'scene' && !raf) requestAnimationFrame(frame); });
})(window.CC);
