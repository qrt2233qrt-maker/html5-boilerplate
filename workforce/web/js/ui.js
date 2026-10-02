// UI primitives: toasts, bottom sheet, confirm dialog, form helpers and
// animated lists. Motion is calm and precise; everything respects reduced motion.
import { $, $$, html, mount } from './util.js';
import { has, t } from './i18n.js';
import { CHECK, ICON } from './icons.js';

const rmq = matchMedia('(prefers-reduced-motion: reduce)');
export const MOTION = {
  quick: 180, base: 240, screen: 340, emph: 700,
  out: 'cubic-bezier(.22,1,.36,1)', in: 'cubic-bezier(.55,0,1,.45)', inout: 'cubic-bezier(.65,0,.35,1)',
  get reduced() { return rmq.matches; },
};

// ---------- errors ----------

// A translated, user-safe message for any failure.
export function errorMessage(err) {
  const code = err?.code || 'server_error';
  const reason = err?.details?.reason;
  if (reason && has(`e.${code}.${reason}`)) return t(`e.${code}.${reason}`);
  if (has(`e.${code}`)) return t(`e.${code}`);
  return err?.message || t('e.server_error');
}

// ---------- toasts ----------

export function toast(msg, { action, onAction, ms = 5000, error = false } = {}) {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.setAttribute('role', error ? 'alert' : 'status');
  const s = document.createElement('span');
  s.textContent = msg;
  el.append(s);
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    if (!el.isConnected) return;
    if (MOTION.reduced) return el.remove();
    el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], { duration: MOTION.quick, easing: MOTION.in })
      .finished.then(() => el.remove(), () => el.remove());
  };
  if (action) {
    const b = document.createElement('button');
    b.textContent = action;
    b.onclick = () => { onAction?.(); dismiss(); };
    el.append(b);
  }
  host.append(el);
  if (!MOTION.reduced) el.animate([{ transform: 'translateY(16px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: MOTION.base, easing: MOTION.out });
  timer = setTimeout(dismiss, ms);
}

export const toastError = (err) => toast(errorMessage(err), { error: true, ms: 7000 });

// ---------- motion helpers ----------

export function shake(el) {
  if (!el || MOTION.reduced) return;
  el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 280, easing: 'ease-out' });
}

export function animateIn(el, i = 0) {
  if (MOTION.reduced) return;
  el.animate([{ opacity: 0, transform: 'translateY(-8px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: MOTION.base, easing: MOTION.out, delay: Math.min(i, 10) * 32, fill: 'backwards' });
}

function captureFlip(nodes) {
  const items = [...nodes];
  const first = new Map(items.map((n) => [n, n.getBoundingClientRect()]));
  return () => {
    if (MOTION.reduced) return;
    for (const n of items) {
      if (!n.isConnected) continue;
      const a = first.get(n);
      const b = n.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        n.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: MOTION.base, easing: MOTION.inout });
      }
    }
  };
}

// Keyed list: new items drop in, removed ones leave, the rest slide (FLIP).
// items = [{ key, tpl }]
export function syncList(box, items) {
  const firstRun = !box.dataset.ready;
  box.dataset.ready = '1';
  const existing = new Map([...box.children].map((n) => [n.dataset.key, n]));
  const play = captureFlip(box.children);
  const keep = new Set(items.map((i) => i.key));
  existing.forEach((n, k) => { if (!keep.has(k)) n.remove(); });
  let prev = null;
  const added = [];
  for (const it of items) {
    let n = existing.get(it.key);
    const markup = String(it.tpl);
    if (!n) {
      n = document.createElement('div');
      n.className = 'li';
      n.dataset.key = it.key;
      n.innerHTML = markup;
      n._h = markup;
      added.push(n);
    } else if (n._h !== markup) {
      n.innerHTML = markup;
      n._h = markup;
    }
    const want = prev ? prev.nextSibling : box.firstChild;
    if (want !== n) box.insertBefore(n, want);
    prev = n;
  }
  play();
  added.forEach((n, i) => animateIn(n, firstRun ? i : 0));
}

export function removeAnimated(el) {
  if (!el) return Promise.resolve();
  if (MOTION.reduced) { el.remove(); return Promise.resolve(); }
  return el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(calc(12px * var(--dirx)))' }], { duration: MOTION.quick, easing: MOTION.in })
    .finished.then(() => el.remove(), () => el.remove());
}

// ---------- buttons ----------

export function busy(btn, on = true) {
  if (!btn) return;
  btn.setAttribute('aria-busy', on ? 'true' : 'false');
  btn.disabled = on;
}

// Turns the button into a check for a moment: the success signature.
export function success(btn, label = t('saved')) {
  if (!btn) return Promise.resolve();
  busy(btn, false);
  const old = btn.innerHTML;
  btn.innerHTML = `${CHECK}<span>${label.replace(/[<>&]/g, '')}</span>`;
  btn.classList.add('done');
  btn.disabled = true;
  return new Promise((r) => setTimeout(() => {
    btn.innerHTML = old;
    btn.classList.remove('done');
    btn.disabled = false;
    r();
  }, MOTION.reduced ? 400 : 900));
}

// ---------- forms ----------

export function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

export function clearErrors(form) {
  $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
  $$('.err', form).forEach((e) => { e.textContent = ''; });
  const fe = $('.form-error', form);
  if (fe) fe.textContent = '';
}

export function fieldError(form, name, msg) {
  const input = form.elements[name];
  if (!input) return formError(form, msg);
  input.setAttribute('aria-invalid', 'true');
  const err = $(`#err-${name}`, form);
  if (err) err.textContent = msg;
  shake(input.closest('.field') || input);
  input.focus();
}

export function formError(form, msg, requestId) {
  const fe = $('.form-error', form);
  if (!fe) return toast(msg, { error: true });
  fe.textContent = msg;
  if (requestId) {
    const ref = document.createElement('small');
    ref.className = 'sr';
    ref.textContent = t('errorRef', { id: requestId });
    fe.append(ref);
  }
  shake(fe);
}

const FIELD_FOR = {
  invalid_email: 'email', invalid_phone: 'phone', weak_password: 'password', invalid_code: 'code',
  wrong_password: 'currentPassword', contact_required: 'email',
};

// Shows an API error next to the right field when we know which one.
export function showApiError(form, err, fieldMap = {}) {
  const field = fieldMap[err.code] ?? FIELD_FOR[err.code];
  if (field && form.elements[field]) return fieldError(form, field, errorMessage(err));
  formError(form, errorMessage(err), err.requestId);
}

// Wires a form: validation, busy state, and error display. handler returns
// a promise; throwing an ApiError shows it in the form.
export function onSubmit(form, handler, { fieldMap } = {}) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearErrors(form);
    for (const input of $$('[data-required]', form)) {
      if (!String(input.value).trim()) return fieldError(form, input.name, t('e.required'));
    }
    // The submit button may sit outside the form (sheet footer, form="id").
    const btn = $('button[type=submit]', form) || (form.id ? $(`button[type=submit][form="${form.id}"]`) : null);
    busy(btn);
    try {
      await handler(formData(form), btn);
    } catch (err) {
      if (err?.code) showApiError(form, err, fieldMap);
      else {
        console.error(err);
        formError(form, t('e.server_error'));
      }
    } finally {
      if (btn?.getAttribute('aria-busy') === 'true') busy(btn, false);
    }
  });
}

export function passwordToggles(root) {
  $$('.pw button', root).forEach((b) => {
    b.addEventListener('click', () => {
      const input = b.previousElementSibling;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.textContent = show ? t('hidePassword') : t('showPassword');
      b.setAttribute('aria-pressed', String(show));
    });
  });
}

// Field markup helpers keep forms consistent and accessible.
export function field({ name, label, type = 'text', value = '', autocomplete, inputmode, required, optional, hint, attrs = '', cls = '' }) {
  const id = `f-${name}`;
  const isPw = type === 'password';
  const input = html`<input class="input ${cls}" id="${id}" name="${name}" type="${type}" value="${value}" ${autocomplete ? html`autocomplete="${autocomplete}"` : ''} ${inputmode ? html`inputmode="${inputmode}"` : ''} ${required ? html`data-required aria-required="true"` : ''} aria-describedby="err-${name}${hint ? ` hint-${name}` : ''}" ${attrs}>`;
  return html`<div class="field">
    <label class="label" for="${id}">${label}${optional ? html` <span class="opt muted">(${t('optional')})</span>` : ''}</label>
    ${isPw ? html`<div class="pw">${input}<button type="button" aria-pressed="false" aria-controls="${id}">${t('showPassword')}</button></div>` : input}
    ${hint ? html`<span class="hint" id="hint-${name}">${hint}</span>` : ''}
    <span class="err" id="err-${name}" aria-live="polite"></span>
  </div>`;
}

// ---------- sheet ----------

// Bottom sheet on phones, centred dialog on desktop. Returns the sheet body.
export function openSheet({ title, body, foot = '' }) {
  const sheet = $('#sheet');
  mount(sheet, html`<div class="grab" aria-hidden="true"></div>
    <div class="shead"><h2 id="sheet-title">${title}</h2><button class="iconbtn" type="button" data-close aria-label="${t('close')}">${ICON.x}</button></div>
    <div class="sbody">${body}</div><div class="sfoot">${foot}</div>`);
  $('[data-close]', sheet).onclick = closeSheet;
  if (!sheet.open) sheet.showModal();
  return sheet;
}

export function closeSheet() {
  const sheet = $('#sheet');
  if (sheet?.open) sheet.close();
}

// ---------- confirm ----------

export function confirmDialog({ title, body = '', confirm, danger = false }) {
  const dlg = $('#confirm');
  mount(dlg, html`<h2 id="confirm-title">${title}</h2>${body ? html`<p>${body}</p>` : ''}
    <div class="acts"><button class="btn" type="button" data-no>${t('cancel')}</button>
    <button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-yes>${confirm}</button></div>`);
  dlg.setAttribute('aria-labelledby', 'confirm-title');
  return new Promise((resolve) => {
    const done = (v) => {
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    $('[data-no]', dlg).onclick = () => done(false);
    $('[data-yes]', dlg).onclick = () => done(true);
    dlg.onclose = () => resolve(false);
    dlg.showModal();
    $('[data-no]', dlg).focus();
  });
}

export function skeletonRows(n = 4) {
  return html`<div class="listbox">${Array.from({ length: n }, () => html`<div class="skeleton sk-row"></div>`)}</div>`;
}

export function copyText(text, btn) {
  navigator.clipboard?.writeText(text).then(() => {
    if (btn) {
      const old = btn.textContent;
      btn.textContent = t('copied');
      setTimeout(() => { btn.textContent = old; }, 1500);
    }
  }, () => toast(t('e.server_error'), { error: true }));
}
