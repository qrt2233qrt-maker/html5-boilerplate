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
      const cs = getComputedStyle(document.documentElement), cols = [cs.getPropertyValue('--accent').trim(), cs.getPropertyValue('--accent2').trim(), cs.getPropertyValue('--violet').trim(), '#ffffff'], n = m === 'full' ? 26 : 12;
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
    if (S.look === 'midnight') r.removeAttribute('data-look'); else r.setAttribute('data-look', S.look);
    if (S.font === 'elegant') r.removeAttribute('data-font'); else r.setAttribute('data-font', S.font);
    r.setAttribute('data-density', S.density); r.setAttribute('data-motion', CC.motion()); r.setAttribute('data-exp', S.bg.exp);
    if (S.accent) r.style.setProperty('--accent', S.accent); else r.style.removeProperty('--accent');
    // how solid the panels are; the light theme keeps more fill so dark text stays readable
    const p = S.look === 'blush' ? Math.max(S.panel, 62) : S.panel;
    r.style.setProperty('--panel', p + '%'); r.style.setProperty('--panel2', Math.round(p * .8) + '%'); r.style.setProperty('--panel3', Math.min(100, p + 25) + '%'); r.style.setProperty('--pblur', S.pblur + 'px');
    r.style.setProperty('--tsh', S.look === 'blush' || p > 55 ? 'none' : '0 1px 3px rgba(0, 0, 0, .75)');
    CC.bg.apply();
  };

  // ---------- backgrounds: a built-in picture (chosen in CSS by data-exp) or a slideshow of the user's photos ----------
  let slideT = 0, slideI = 0, flip = false;
  const slides = () => { const u = CC.uploads.map((x) => x.id); return u.length ? u : CC.pool(); };
  function showSlide() { const l = slides(); if (!l.length) return; const els = document.querySelectorAll('#bg-media .bg-ph'), el = els[flip ? 1 : 0], other = els[flip ? 0 : 1]; el.style.backgroundImage = 'url("' + CC.srcOf(l[slideI % l.length]) + '")'; el.classList.add('on'); other.classList.remove('on'); flip = !flip; slideI++; }
  CC.bg = {
    apply() {
      const pic = $('#bg-clouds'), media = $('#bg-media'), b = S.bg; if (!pic) return;
      clearInterval(slideT);
      pic.hidden = b.exp === 'photos'; media.hidden = b.exp !== 'photos';
      const f = 'blur(' + b.blur + 'px) brightness(' + b.bright + '%)'; media.style.filter = f; pic.style.filter = f; media.style.setProperty('--fade', b.fade + 's');
      $('#bg-dim').style.opacity = b.dim / 100;
      if (b.exp === 'photos') { showSlide(); if (slides().length > 1) slideT = setInterval(showSlide, Math.max(4, b.secs) * 1000); }
    }
  };
})(window.CC);
