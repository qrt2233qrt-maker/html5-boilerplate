import pg from 'pg';
import { loadConfig } from '../server/config.js';
import { buildApp } from '../server/app.js';
import { migrate } from '../server/db/migrate.js';

export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/workforce_test';

// Fresh schema, real Postgres, captured email/SMS.
export async function setup(env = {}) {
  const pool = new pg.Pool({ connectionString: TEST_DB, max: 5 });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  const sent = [];
  const capture = async (msg) => { sent.push({ ...msg }); };
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB, APP_URL: 'http://app.test', ...env });
  const app = await buildApp(config, { pool, logger: process.env.TEST_LOG ? { level: 'error' } : false, transports: { email: capture, sms: capture } });
  return {
    app,
    pool,
    sent,
    async close() {
      await app.close();
      await pool.end();
    },
    // Latest message to a recipient, after delivering everything queued.
    async lastMessage(to) {
      await app.outbox.flush();
      return [...sent].reverse().find((m) => m.recipient === to);
    },
  };
}

export const codeIn = (msg) => msg.body.match(/\b(\d{6})\b/)[1];
export const tokenIn = (msg, key = 'token') => msg.body.match(new RegExp(`${key}=([A-Za-z0-9_-]+)`))[1];

// A browser-like client: keeps its cookie and sends the CSRF token.
export function client(app, ip = '127.0.0.1') {
  let cookie = null;
  let csrf = null;
  async function call(method, url, payload) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    const res = await app.inject({ method, url, payload, headers, remoteAddress: ip });
    const set = res.cookies.find((c) => c.name === 'wf_session');
    if (set) cookie = set.value ? `wf_session=${set.value}` : null;
    const body = res.body ? JSON.parse(res.body) : null;
    return { status: res.statusCode, body };
  }
  const c = {
    get: (url) => call('GET', url),
    post: (url, payload = {}) => call('POST', url, payload),
    put: (url, payload = {}) => call('PUT', url, payload),
    del: (url) => call('DELETE', url),
    async refresh() {
      const res = await call('GET', '/api/auth/me');
      csrf = res.body?.csrfToken ?? null;
      return res.body;
    },
    get cookie() { return cookie; },
    get csrf() { return csrf; },
    setCsrf(v) { csrf = v; },
  };
  return c;
}

export const PASSWORD = 'correct horse battery';

// Registers a business with a verified owner and returns their client.
export async function ownerWithBusiness(t, { email = 'owner@example.com', businessName = 'Al-Noor Bakery', name = 'Owner One' } = {}) {
  const owner = client(t.app);
  const reg = await owner.post('/api/auth/register', { businessName, name, email, password: PASSWORD });
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
  await owner.refresh();
  const msg = await t.lastMessage(email);
  await owner.post('/api/auth/verify/email', { code: codeIn(msg) });
  const me = await owner.refresh();
  return { owner, businessId: me.businesses[0].id, me };
}

// Invites someone and has them accept. Returns their client and membership id.
export async function addMember(t, owner, businessId, { email, name = 'Team Member', role = 'employee', profile } = {}) {
  const inv = await owner.post(`/api/b/${businessId}/invitations`, { name, email, role, profile });
  if (inv.status !== 201) throw new Error(JSON.stringify(inv.body));
  const token = tokenIn(await t.lastMessage(email));
  const member = client(t.app);
  const acc = await member.post('/api/invitations/accept', { token, name, password: PASSWORD });
  if (acc.status !== 200) throw new Error(JSON.stringify(acc.body));
  await member.refresh();
  const list = await owner.get(`/api/b/${businessId}/members?q=${encodeURIComponent(email)}`);
  return { member, membershipId: list.body.items[0].membershipId };
}
