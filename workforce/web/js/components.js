// Reusable pieces for the module pages: date ranges, KPI tiles, status
// pills, generic form sheets, file upload with receipt compression.
import { api } from './api.js';
import { LANG, t } from './i18n.js';
import { ICON } from './icons.js';
import { PRESETS, money, pct, presetRange, todayLocal } from './fmt.js';
import { countUp } from './charts.js';
import { S, bpath, isOwner } from './state.js';
import { closeSheet, field, fieldError, onSubmit, openSheet, success, toast } from './ui.js';
import { $, LS, html, mount, parseMoney, raw } from './util.js';

// ---------- date range (spec §13) ----------

export function rangeState(key, fallback = 'thisMonth') {
  let saved = null;
  try { saved = JSON.parse(LS.get(`range:${key}`) || 'null'); } catch { /* ignore */ }
  if (saved?.preset && saved.preset !== 'custom') {
    const [from, to] = presetRange(saved.preset);
    return { preset: saved.preset, from, to };
  }
  if (saved?.from && saved?.to) return saved;
  const [from, to] = presetRange(fallback);
  return { preset: fallback, from, to };
}

export function dateRangeBar(host, key, value, onChange) {
  const draw = () => {
    mount(host, html`<div class="range">
      <select class="input" data-preset aria-label="${t('dateRange')}">
        ${PRESETS.map((p) => html`<option value="${p}" ${value.preset === p ? 'selected' : ''}>${t(`range_${p}`)}</option>`)}
      </select>
      <span class="custom ${value.preset === 'custom' ? '' : 'hidden'}">
        <input class="input" type="date" data-from value="${value.from}" aria-label="${t('from')}">
        <span aria-hidden="true">–</span>
        <input class="input" type="date" data-to value="${value.to}" aria-label="${t('to')}">
      </span></div>`);
    $('[data-preset]', host).onchange = (e) => {
      value.preset = e.target.value;
      if (value.preset !== 'custom') [value.from, value.to] = presetRange(value.preset);
      emit();
      draw();
    };
    for (const k of ['from', 'to']) {
      $(`[data-${k}]`, host).onchange = (e) => {
        value[k] = e.target.value;
        if (value.from && value.to && value.from <= value.to) emit();
      };
    }
  };
  const emit = () => {
    LS.set(`range:${key}`, JSON.stringify(value));
    onChange({ ...value });
  };
  draw();
}

// ---------- KPI tile (spec §41) ----------

export function kpiTile({ label, value, change, kind = 'money', goodWhenUp = true, big = false }) {
  const fmt = kind === 'money' ? money : kind === 'pct' ? (v) => pct(v, 1) : (v) => new Intl.NumberFormat(LANG === 'ar' ? 'ar-IQ' : 'en-GB').format(v);
  let delta = '';
  if (change !== null && change !== undefined && Number.isFinite(change)) {
    const up = change > 0;
    const good = change === 0 ? null : up === goodWhenUp;
    const text = kind === 'pct' ? `${up ? '+' : ''}${(change * 100).toFixed(1)} ${t('points')}` : `${up ? '↑' : change < 0 ? '↓' : ''} ${pct(Math.abs(change), 1)}`;
    delta = html`<span class="delta ${good === null ? '' : good ? 'good' : 'bad'}">${text}<span class="sr"> ${t('vsPrevious')}</span></span>`;
  }
  const id = `k${Math.random().toString(36).slice(2, 8)}`;
  return {
    tpl: html`<div class="kpi ${big ? 'big' : ''}"><small>${label}</small><b class="num" id="${id}">${value === null || value === undefined ? '—' : fmt(0)}</b>${delta}</div>`,
    animate: (root) => { const n = root.querySelector(`#${id}`); if (n && value !== null && value !== undefined) (kind === 'money' ? countUp(n, value, fmt) : (n.textContent = fmt(value))); },
  };
}

// ---------- status pills ----------

const STATUS_CLASS = {
  pending: 'warn', submitted: 'warn', under_review: 'info', pending_peer: 'warn', pending_approval: 'info', review: 'over', draft: '',
  approved: 'ok', completed: 'ok', paid: 'ok', reimbursed: 'info', finalized: 'info', scheduled: 'info', working: 'ok', done: 'ok',
  rejected: 'over', cancelled: '', missed: 'over', late: 'warn', open: 'warn', upcoming: '',
};
export const statusPill = (s) => html`<span class="pill ${STATUS_CLASS[s] ?? ''}">${s === 'paid' ? '🟢 ' : s === 'pending' ? '🟡 ' : s === 'review' ? '🔴 ' : ''}${t(`st_${s}`)}</span>`;

export const empty = (title, body = '', action = '') => html`<div class="empty"><b>${title}</b>${body}${action ? html`<br>${action}` : ''}</div>`;

// ---------- generic form sheet ----------

/**
 * fields: [{ name, label, type, value, required, options: [[value, label]], hint, optional, full }]
 * types: text, textarea, money, signedMoney, date, time, datetime (date+time pair), select, seg, checkbox, number, file
 * onSubmit(values, button) may throw an ApiError; it is shown on the form.
 */
export function formSheet({ title, intro, fields, submitLabel = t('save'), danger = false, onSubmit: handler, extraFoot = '' }) {
  const exp = S.business.currencyExponent;
  const control = (f) => {
    const v = f.value ?? '';
    switch (f.type) {
    case 'textarea':
      return html`<div class="field ${f.full ? 'full' : ''}"><label class="label" for="f-${f.name}">${f.label}${f.optional ? html` <span class="opt muted">(${t('optional')})</span>` : ''}</label>
        <textarea class="input" id="f-${f.name}" name="${f.name}" maxlength="${f.max || 1000}" ${f.required ? 'data-required' : ''}>${v}</textarea><span class="err" id="err-${f.name}"></span></div>`;
    case 'money': case 'signedMoney':
      return field({ name: f.name, label: `${f.label} (${S.business.currency})`, inputmode: 'decimal', required: f.required, optional: f.optional, hint: f.hint, cls: 'money-in', value: v === '' ? '' : (v / 10 ** exp).toString(), attrs: html`dir="ltr" autocomplete="off"` });
    case 'select':
      return html`<div class="field"><label class="label" for="f-${f.name}">${f.label}${f.optional ? html` <span class="opt muted">(${t('optional')})</span>` : ''}</label>
        <select class="input" id="f-${f.name}" name="${f.name}" ${f.required ? 'data-required' : ''}>
          ${f.optional || f.blank ? html`<option value="">${f.blank || '—'}</option>` : ''}
          ${f.options.map(([ov, ol]) => html`<option value="${ov}" ${String(ov) === String(v) ? 'selected' : ''}>${ol}</option>`)}
        </select>${f.hint ? html`<span class="hint">${f.hint}</span>` : ''}<span class="err" id="err-${f.name}"></span></div>`;
    case 'seg':
      return html`<div class="field ${f.full ? 'full' : ''}"><span class="label" id="l-${f.name}">${f.label}</span><div class="seg" role="radiogroup" aria-labelledby="l-${f.name}">
        ${f.options.map(([ov, ol]) => html`<label><input type="radio" name="${f.name}" value="${ov}" ${String(ov) === String(v) ? 'checked' : ''}><span>${ol}</span></label>`)}
      </div><span class="err" id="err-${f.name}"></span></div>`;
    case 'checkbox':
      return html`<label class="check-row"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> <span>${f.label}</span></label>`;
    case 'file':
      return html`<div class="field full"><span class="label">${f.label}${f.optional ? html` <span class="opt muted">(${t('optional')})</span>` : ''}</span>
        <div class="upload" data-upload="${f.name}"><input type="hidden" name="${f.name}" value="${v}">
          <button class="btn small" type="button" data-pick>${ICON.cam || ICON.plus}${t('attachFile')}</button><span class="up-name muted small"></span>
          <input type="file" hidden accept="${f.accept || 'image/*,application/pdf'}" ${f.capture ? 'capture="environment"' : ''}></div>
        <span class="err" id="err-${f.name}"></span></div>`;
    case 'datetime':
      return html`<div class="field"><span class="label">${f.label}</span><div class="dt">
        <input class="input" type="date" name="${f.name}Day" value="${v.day || ''}" aria-label="${f.label}" ${f.required ? 'data-required' : ''}>
        <input class="input" type="time" name="${f.name}Time" value="${v.time || ''}" aria-label="${f.label}" ${f.required ? 'data-required' : ''}></div>
        <span class="err" id="err-${f.name}Day"></span></div>`;
    default:
      return field({ name: f.name, label: f.label, type: f.type || 'text', value: v, required: f.required, optional: f.optional, hint: f.hint, inputmode: f.type === 'number' ? 'numeric' : undefined, attrs: raw(f.attrs || '') });
    }
  };
  const sheet = openSheet({
    title,
    body: html`${intro ? html`<p class="muted">${intro}</p>` : ''}<form id="fs-form" novalidate><div class="form-error" role="alert"></div>
      <div class="form-grid">${fields.filter(Boolean).map(control)}</div></form>`,
    foot: html`${extraFoot}<button class="btn ${danger ? 'danger' : 'primary'}" type="submit" form="fs-form">${submitLabel}</button>`,
  });
  const form = $('#fs-form', sheet);
  for (const up of sheet.querySelectorAll('[data-upload]')) wireUpload(up);
  onSubmit(form, async (raw0, btn) => {
    const out = {};
    for (const f of fields.filter(Boolean)) {
      if (f.type === 'money' || f.type === 'signedMoney') {
        const s = String(raw0[f.name] || '').trim();
        if (!s) { if (f.required) return fieldError(form, f.name, t('e.required')); out[f.name] = undefined; continue; }
        const neg = f.type === 'signedMoney' && /^-|^−/.test(s);
        const n = parseMoney(s.replace(/^[-−]/, ''), exp);
        if (n === null || (n === 0 && f.type === 'money')) return fieldError(form, f.name, t('e.amount'));
        out[f.name] = neg ? -n : n;
      } else if (f.type === 'checkbox') {
        out[f.name] = !!form.elements[f.name].checked;
      } else if (f.type === 'datetime') {
        out[f.name] = { day: raw0[`${f.name}Day`], time: raw0[`${f.name}Time`] };
      } else if (f.type === 'number') {
        out[f.name] = raw0[f.name] === '' ? undefined : Number(raw0[f.name]);
      } else {
        out[f.name] = raw0[f.name] === '' ? (f.optional ? null : undefined) : raw0[f.name];
      }
    }
    const result = await handler(out, btn, form);
    if (result === false) return;
    await success(btn, t('saved'));
    closeSheet();
  });
  return sheet;
}

// ---------- uploads ----------

// Shrinks photos on the device before upload (from the expenses app).
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    let max = 1600;
    let q = 0.82;
    let out;
    for (let a = 0; a < 8; a++) {
      const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * sc);
      c.height = Math.round(img.naturalHeight * sc);
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q);
      if (out.length < 900000) break;
      if (q > 0.55) q -= 0.1; else max = Math.round(max * 0.8);
    }
    return out.split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = rej;
  r.readAsDataURL(file);
});

export async function uploadFile(file, { kind = 'receipt', membershipId } = {}) {
  const isImage = /^image\//.test(file.type);
  const data = isImage ? await compressImage(file) : await toBase64(file);
  const name = isImage ? file.name.replace(/\.[^.]+$/, '') + '.jpg' : file.name;
  return api.post(bpath('/documents'), { data, filename: name, kind, membershipId });
}

function wireUpload(up) {
  const input = up.querySelector('input[type=file]');
  const hidden = up.querySelector('input[type=hidden]');
  const label = up.querySelector('.up-name');
  up.querySelector('[data-pick]').onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    label.textContent = t('uploading');
    try {
      const doc = await uploadFile(file, { kind: up.closest('form')?.dataset.kind || 'receipt' });
      hidden.value = doc.id;
      label.textContent = `✓ ${doc.filename}`;
    } catch (err) {
      label.textContent = '';
      toast(err.code ? t(`e.${err.code}`) : t('e.server_error'), { error: true });
    }
  };
}

export const docUrl = (id, download = false) => bpath(`/documents/${id}${download ? '?download=true' : ''}`);

// Today's date for date inputs.
export const today = todayLocal;

// An employee claim this person should act on now. A claim the manager
// already approved and that waits for the owner isn't the manager's to decide.
export const waitingOnMe = (c) => ['submitted', 'under_review'].includes(c.status) && (isOwner() || c.approvalStep !== 2);
