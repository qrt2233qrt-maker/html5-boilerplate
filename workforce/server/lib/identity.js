import { badRequest } from './errors.js';

// Arabic-Indic (٠-٩) and Persian (۰-۹) digits become 0-9.
export const asciiDigits = (value) => String(value ?? '')
  .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
  .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

// One-time codes as typed: any digit script, spaces ignored.
export const normalizeCode = (code) => asciiDigits(code).replace(/\s/g, '');

// Recovery codes look like ABCD-EFGH; accept lowercase and a missing dash.
export function normalizeRecoveryCode(code) {
  const c = normalizeCode(code).toUpperCase().replace(/-/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export function normalizeEmail(email) {
  if (email === undefined || email === null || email === '') return null;
  const e = String(email).trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    throw badRequest('invalid_email', 'Enter a valid email address.');
  }
  return e;
}

// Phones are stored in E.164 (+9647701234567). Arabic-Indic digits are
// accepted, and Iraqi local numbers starting with 07 get the +964 prefix.
export function normalizePhone(phone, defaultCountry = '964') {
  if (phone === undefined || phone === null || phone === '') return null;
  let p = asciiDigits(phone).replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  else if (p.startsWith('0')) p = '+' + defaultCountry + p.slice(1);
  if (!/^\+[1-9]\d{6,14}$/.test(p)) {
    throw badRequest('invalid_phone', 'Enter a valid phone number with its country code.');
  }
  return p;
}

// "email or phone" sign-in field.
export function parseIdentifier(identifier) {
  const raw = String(identifier || '').trim();
  if (raw.includes('@')) return { email: normalizeEmail(raw) };
  return { phone: normalizePhone(raw) };
}

export function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export function maskPhone(phone) {
  if (!phone) return null;
  return `${phone.slice(0, 4)}${'•'.repeat(Math.max(1, phone.length - 7))}${phone.slice(-3)}`;
}
