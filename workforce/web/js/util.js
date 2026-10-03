// Small helpers shared by every module.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const LS = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { /* storage unavailable */ }
  },
};

export const SS = {
  get(k) {
    try { return sessionStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { sessionStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
  del(k) {
    try { sessionStorage.removeItem(k); } catch { /* storage unavailable */ }
  },
};

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Trusted markup. Only our own templates and icons are wrapped in Raw.
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

// html`<b>${name}</b>` escapes every value unless it is itself html`` or raw().
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Raw(out);
}

export function mount(el, tpl) {
  el.innerHTML = part(tpl);
  return el;
}

export const initials = (name) => {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Arabic-Indic digits typed on Arabic keyboards become 0-9.
export const asciiDigits = (s) => String(s ?? '')
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

// Amount typed in major units (e.g. "12,500" or "١٢٥٠٠") to integer minor units.
export function parseMoney(input, exponent) {
  const s = asciiDigits(input).replace(/[^\d.]/g, '');
  if (!s) return null;
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole || '0') * 10 ** exponent + Number((frac + '0'.repeat(exponent)).slice(0, exponent) || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

// "Chrome on Android" from a user-agent string. Good enough to recognise a device.
export function deviceName(ua) {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return { browser, os, mobile: /Mobile|iPhone|Android/.test(ua) };
}
