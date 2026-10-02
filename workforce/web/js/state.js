// Who is signed in, which business they're looking at, and what they may do.
// The server checks every permission again; this only decides what to show.
import { api, setCsrf } from './api.js';
import { LS } from './util.js';

export const S = { me: null, business: null, perms: new Set() };

export async function loadMe() {
  try {
    S.me = await api.get('/api/auth/me');
    setCsrf(S.me.csrfToken);
  } catch (err) {
    if (err.status !== 401) throw err;
    S.me = null;
    setCsrf(null);
  }
  pickBusiness();
  return S.me;
}

export const activeBusinesses = () => (S.me?.businesses || []).filter((b) => b.status === 'active');

export function pickBusiness(id = LS.get('business')) {
  const list = activeBusinesses();
  S.business = list.find((b) => b.id === id) || list[0] || null;
  S.perms = new Set(S.business?.permissions || []);
  if (S.business) LS.set('business', S.business.id);
}

export const can = (...perms) => perms.every((p) => S.perms.has(p));
export const isOwner = () => S.business?.role === 'owner';
export const bpath = (p = '') => `/api/b/${S.business.id}${p}`;

// Which verification the user still owes, if any.
export function pendingVerification() {
  const u = S.me?.user;
  if (!u) return null;
  if (!S.me.businesses.some((b) => b.status === 'active' && !b.verified)) return null;
  if (u.email && !u.emailVerified) return 'email';
  if (u.phone && !u.phoneVerified) return 'phone';
  return null;
}

export function clearSession() {
  S.me = null;
  S.business = null;
  S.perms = new Set();
  setCsrf(null);
}
