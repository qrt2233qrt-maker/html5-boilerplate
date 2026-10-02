// Money, time-zone and date-range helpers. Shifts are stored in UTC and
// shown and entered in the business's time zone, whatever the device's.
import { LANG, fmtMoney, locale, t } from './i18n.js';
import { S } from './state.js';

export const tz = () => S.business?.timezone || 'Asia/Baghdad';
export const money = (minor) => fmtMoney(minor || 0, S.business.currency, S.business.currencyExponent);
export const moneyShort = (minor) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format((minor || 0) / 10 ** S.business.currencyExponent);
export const pct = (n, digits = 0) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: digits }).format(n));
export const num = (n, digits = 1) => new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(n || 0);
export const hours = (n) => `${num(n)} ${t('hoursShort')}`;

// Parts of an instant in a time zone.
function parts(date, zone) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return Object.fromEntries(f.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
}

// "2026-10-02" + "09:30" in the business zone -> ISO UTC string.
export function zonedToIso(day, time, zone = tz()) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Offset of the zone at that moment, applied twice to settle DST edges.
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(ts), zone);
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    ts = guess - (asUtc - ts);
  }
  return new Date(ts).toISOString();
}

export function isoToZoned(iso, zone = tz()) {
  const p = parts(new Date(iso), zone);
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const todayLocal = () => isoToZoned(new Date().toISOString()).day;
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

export function weekStartOf(day, weekStartsOn = S.settings?.payroll?.weekStartsOn ?? 6) {
  return addDays(day, -((weekdayOf(day) - weekStartsOn + 7) % 7));
}

export function time(iso) {
  return new Intl.DateTimeFormat(locale(), { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
export function dayLabel(dayOrIso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const d = dayOrIso.length === 10 ? new Date(`${dayOrIso}T12:00:00Z`) : new Date(dayOrIso);
  return new Intl.DateTimeFormat(locale(), { timeZone: dayOrIso.length === 10 ? 'UTC' : tz(), ...opts }).format(d);
}
export const shiftRange = (s) => `${dayLabel(s.startsAt)} · ${time(s.startsAt)}–${time(s.endsAt)}`;
export const dateShort = (day) => dayLabel(String(day).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' });

// Date-range presets (spec §13). Weeks follow the business's week start.
export const PRESETS = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'lastYear', 'custom'];

export function presetRange(key, ref = todayLocal()) {
  const [y, m] = ref.split('-').map(Number);
  const monthStart = (yy, mm) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  const monthEnd = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  switch (key) {
  case 'today': return [ref, ref];
  case 'yesterday': return [addDays(ref, -1), addDays(ref, -1)];
  case 'thisWeek': { const s = weekStartOf(ref); return [s, addDays(s, 6)]; }
  case 'lastWeek': { const s = addDays(weekStartOf(ref), -7); return [s, addDays(s, 6)]; }
  case 'thisMonth': return [monthStart(y, m), monthEnd(y, m)];
  case 'lastMonth': return [monthStart(y, m - 1), monthEnd(y, m - 1)];
  case 'thisQuarter': { const q = Math.floor((m - 1) / 3) * 3 + 1; return [monthStart(y, q), monthEnd(y, q + 2)]; }
  case 'thisYear': return [`${y}-01-01`, `${y}-12-31`];
  case 'lastYear': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  default: return null;
  }
}

export const dirIsRtl = () => LANG === 'ar';
