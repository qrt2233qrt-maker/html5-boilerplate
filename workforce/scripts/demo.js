// Fills a database with a realistic demo business: a bakery in Baghdad with
// a manager, five employees, eight weeks of shifts and attendance, six
// months of sales and expenses, budgets, claims and payroll.
//
//   DATABASE_URL=postgres://… npm run demo
//
// Everything goes through the real API (in-process), so the same
// permission checks, validation and history apply as for real users.
// Refuses to run in production or against a database that already has
// the demo owner.
import pg from 'pg';
import { loadConfig } from '../server/config.js';
import { buildApp } from '../server/app.js';
import { migrate } from '../server/db/migrate.js';
import { seedAll } from '../server/services/settings.js';

const PASSWORD = 'demo bakery password';
const OWNER = 'owner@demo.test';
const TZ_OFFSET = '+03:00'; // Asia/Baghdad, no daylight saving

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to load demo data in production.');
  process.exit(1);
}
const config = loadConfig({ ...process.env, NODE_ENV: 'development', EMAIL_TRANSPORT: 'log', SMS_TRANSPORT: 'log' });
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
await migrate(pool);
await seedAll(pool);
if ((await pool.query('SELECT 1 FROM users WHERE email = $1', [OWNER])).rowCount) {
  console.error(`Demo data already exists (${OWNER}). Use a fresh database to load it again.`);
  await pool.end();
  process.exit(1);
}

const sent = [];
const capture = async (m) => { sent.push(m); };
const app = await buildApp(config, { pool, logger: false, transports: { email: capture, sms: capture } });
let ipN = 10;

function client() {
  let cookie = null;
  let csrf = null;
  const ip = `10.0.0.${ipN++}`;
  async function call(method, url, payload) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    const res = await app.inject({ method, url, payload, headers, remoteAddress: ip });
    const set = res.cookies.find((c) => c.name === 'wf_session');
    if (set) cookie = set.value ? `wf_session=${set.value}` : null;
    const body = res.body ? JSON.parse(res.body) : null;
    if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${JSON.stringify(body)}`);
    return body;
  }
  return {
    get: (u) => call('GET', u),
    post: (u, p = {}) => call('POST', u, p),
    put: (u, p = {}) => call('PUT', u, p),
    async refresh() { const me = await call('GET', '/api/auth/me'); csrf = me.csrfToken; return me; },
  };
}
async function lastMessage(to) {
  await app.outbox.flush();
  return [...sent].reverse().find((m) => m.recipient === to).body;
}

// ---------- dates in the business's time zone ----------
const pad = (n) => String(n).padStart(2, '0');
const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const at = (d, h, m = 0) => `${d}T${pad(h)}:${pad(m)}:00${TZ_OFFSET}`;
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
// Saturday-start week, as in Iraq.
const weekStart = (d) => addDays(d, -((dow(d) - 6 + 7) % 7));
// Deterministic "random" so every load looks the same.
let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const around = (base, spread) => Math.round((base * (1 + (rnd() * 2 - 1) * spread)) / 250) * 250;

// ---------- the business ----------
const owner = client();
await owner.post('/api/auth/register', { businessName: 'مخبز النور', name: 'علي حسن', email: OWNER, password: PASSWORD });
await owner.refresh();
await owner.post('/api/auth/verify/email', { code: (await lastMessage(OWNER)).match(/\b(\d{6})\b/)[1] });
const me = await owner.refresh();
const B = `/api/b/${me.businesses[0].id}`;
console.log('Business created');

const kitchen = await owner.post(`${B}/departments`, { name: 'المطبخ' });
const counter = await owner.post(`${B}/departments`, { name: 'الكاونتر' });
const shop = await owner.post(`${B}/locations`, { name: 'الفرع الرئيسي – الكرادة' });

const people = [
  { key: 'manager', name: 'سارة كاظم', email: 'manager@demo.test', role: 'manager', dept: counter.id, jobTitle: 'مديرة الصالة', payType: 'salaried', payRate: 1200000 },
  { key: 'baker1', name: 'حسين علي', email: 'hussein@demo.test', dept: kitchen.id, jobTitle: 'خبّاز', payType: 'hourly', payRate: 5000, start: 5 },
  { key: 'baker2', name: 'مصطفى جاسم', email: 'mustafa@demo.test', dept: kitchen.id, jobTitle: 'خبّاز', payType: 'hourly', payRate: 4500, start: 5 },
  { key: 'cashier1', name: 'زينب محمد', email: 'employee@demo.test', dept: counter.id, jobTitle: 'كاشير', payType: 'hourly', payRate: 4000, start: 9 },
  { key: 'cashier2', name: 'نور الهدى', email: 'noor@demo.test', dept: counter.id, jobTitle: 'كاشير', payType: 'hourly', payRate: 4000, start: 14 },
  { key: 'driver', name: 'أحمد كريم', email: 'ahmed@demo.test', dept: kitchen.id, jobTitle: 'سائق توصيل', payType: 'salaried', payRate: 750000 },
];
const startDate = addDays(localToday, -200);
for (const p of people) {
  await owner.post(`${B}/invitations`, {
    name: p.name, email: p.email, role: p.role || 'employee',
    profile: { jobTitle: p.jobTitle, departmentId: p.dept, payType: p.payType, payRate: p.payRate, startDate },
  });
  const token = (await lastMessage(p.email)).match(/token=([A-Za-z0-9_-]+)/)[1];
  p.client = client();
  await p.client.post('/api/invitations/accept', { token, name: p.name, password: PASSWORD });
  await p.client.refresh();
  p.id = (await owner.get(`${B}/members?q=${encodeURIComponent(p.email)}`)).items[0].membershipId;
}
const by = Object.fromEntries(people.map((p) => [p.key, p]));
await owner.put(`${B}/departments/${counter.id}`, { managerId: by.manager.id });
// Backdate pay rates to the start date so past payroll uses them.
await pool.query('UPDATE pay_rates SET effective_from = $1', [startDate]);
console.log('Team of', people.length, 'joined');

// ---------- shifts and attendance: six past weeks, this week, two ahead (the last as drafts) ----------
const thisWeek = weekStart(localToday);
const hourly = people.filter((p) => p.payType === 'hourly');
let shiftCount = 0;
let attendanceCount = 0;
for (let w = -6; w <= 2; w++) {
  const ws = addDays(thisWeek, w * 7);
  for (const p of hourly) {
    // Five days on, Friday off, plus one rotating day off.
    const off = new Set([6, (hourly.indexOf(p) + w + 12) % 6]);
    for (let i = 0; i < 7; i++) {
      if (off.has(i)) continue;
      const day = addDays(ws, i);
      const s = await owner.post(`${B}/shifts`, {
        membershipId: p.id, departmentId: p.dept, locationId: shop.id,
        startsAt: at(day, p.start), endsAt: at(day, p.start + 8), breakMinutes: 30, published: w <= 1,
      });
      shiftCount++;
      if (day < localToday) {
        // Mostly on time; now and then a few minutes late or a little overtime.
        const late = rnd() < 0.15 ? Math.round(rnd() * 20) : 0;
        const extra = rnd() < 0.2 ? 30 + Math.round(rnd() * 60) : 0;
        if (rnd() < 0.03) continue; // the odd missed shift
        await owner.post(`${B}/attendance`, {
          membershipId: p.id, shiftId: s.id,
          clockIn: at(day, p.start, late), clockOut: new Date(Date.parse(at(day, p.start + 8)) + extra * 60000).toISOString(), breakMinutes: 30,
        });
        attendanceCount++;
      }
    }
  }
}
// One open shift nobody has yet.
await owner.post(`${B}/shifts`, { departmentId: counter.id, locationId: shop.id, startsAt: at(addDays(localToday, 2), 16), endsAt: at(addDays(localToday, 2), 22), published: true });
console.log(shiftCount + 1, 'shifts,', attendanceCount, 'attendance records');

// Requests: a swap waiting for Zainab's answer and a time-off request.
const upcoming = async (p) => (await owner.get(`${B}/shifts?from=${addDays(localToday, 1)}&to=${addDays(localToday, 14)}&membershipId=${p.id}`))
  .filter((s) => s.status === 'scheduled' && s.published);
const noorShifts = await upcoming(by.cashier2);
const zainabShifts = await upcoming(by.cashier1);
if (noorShifts.length && zainabShifts.length) {
  const swap = zainabShifts.find((z) => !noorShifts.some((n) => n.startsAt.slice(0, 10) === z.startsAt.slice(0, 10)));
  const mine = noorShifts.find((n) => !zainabShifts.some((z) => z.startsAt.slice(0, 10) === n.startsAt.slice(0, 10)));
  if (swap && mine) {
    await by.cashier2.client.post(`${B}/swaps`, { myShiftId: mine.id, targetShiftId: swap.id, reason: 'عندي موعد طبيب' }).catch((e) => console.warn('swap skipped:', e.message));
  }
}
const husseinShifts = await upcoming(by.baker1);
if (husseinShifts.length) {
  const day = husseinShifts.at(-1).startsAt.slice(0, 10);
  await by.baker1.client.post(`${B}/shift-requests`, { type: 'time_off', startsAt: at(day, 0), endsAt: at(addDays(day, 1), 0), reason: 'مناسبة عائلية' }).catch((e) => console.warn('time off skipped:', e.message));
}

// ---------- money ----------
const cats = Object.fromEntries((await owner.get(`${B}/categories/expense`)).map((c) => [c.key, c.id]));
const rcats = Object.fromEntries((await owner.get(`${B}/categories/revenue`)).map((c) => [c.key, c.id]));
const firstMonth = `${addDays(localToday, -170).slice(0, 7)}-01`;

await owner.post(`${B}/recurring-expenses`, { amount: 2500000, categoryId: cats.rent, description: 'إيجار المحل', vendor: 'المالك – أبو محمد', frequency: 'monthly', startOn: firstMonth });
await owner.post(`${B}/recurring-expenses`, { amount: 450000, categoryId: cats.electricity, description: 'اشتراك المولّدة', vendor: 'مولّدة الحي', frequency: 'monthly', startOn: addDays(firstMonth, 4) });
await owner.post(`${B}/recurring-expenses`, { amount: 60000, categoryId: cats.internet, description: 'إنترنت', vendor: 'إيرثلنك', frequency: 'monthly', startOn: addDays(firstMonth, 9) });
const { generateDue } = await import('../server/services/finance.js');
await generateDue(pool);

let revenueCount = 0;
let expenseCount = 0;
// Sales grow a little month on month and peak at weekends (Thursday/Friday).
for (let d = firstMonth; d <= localToday; d = addDays(d, 1)) {
  const monthIndex = (Date.parse(d) - Date.parse(firstMonth)) / (30 * 864e5);
  const weekend = [4, 5].includes(dow(d)) ? 1.35 : 1;
  await owner.post(`${B}/revenue`, { amount: around(720000 * (1 + monthIndex * 0.03) * weekend, 0.18), receivedOn: d, categoryId: rcats.sales, paymentMethod: rnd() < 0.8 ? 'cash' : 'card', source: 'مبيعات المحل' });
  revenueCount++;
  if (dow(d) === 0) { // weekly catering orders
    await owner.post(`${B}/revenue`, { amount: around(600000, 0.4), receivedOn: d, categoryId: rcats.services, source: 'طلبيات مناسبات', paymentMethod: 'bank' });
    revenueCount++;
  }
  if (dow(d) === 1 || dow(d) === 4) { // flour, sugar, oil twice a week
    await owner.post(`${B}/business-expenses`, { amount: around(1150000, 0.2), spentOn: d, categoryId: cats.inventory ?? cats.supplies, vendor: 'سوق الشورجة', description: 'طحين وسكر وزيت', paymentMethod: 'cash' });
    expenseCount++;
  }
  if (rnd() < 0.08) {
    const [key, vendor, desc, base] = [
      ['maintenance', 'ورشة الأمين', 'تصليح الفرن', 350000],
      ['fuel', 'محطة الكرادة', 'وقود سيارة التوصيل', 90000],
      ['marketing', 'إنستغرام', 'إعلان ممول', 200000],
      ['supplies', 'مكتبة السلام', 'أكياس وعلب تغليف', 160000],
    ][Math.floor(rnd() * 4)];
    await owner.post(`${B}/business-expenses`, { amount: around(base, 0.3), spentOn: d, categoryId: cats[key] ?? cats.supplies, vendor, description: desc, paymentMethod: 'cash' });
    expenseCount++;
  }
}
// A one-off big purchase so the large-expense alert has something to show.
await owner.post(`${B}/business-expenses`, { amount: 6800000, spentOn: addDays(localToday, -12), categoryId: cats.equipment, vendor: 'شركة الرافدين للمعدات', description: 'عجّانة جديدة', paymentMethod: 'bank' });
await owner.post(`${B}/revenue`, { amount: 85000, receivedOn: addDays(localToday, -3), categoryId: rcats.refunds, description: 'إرجاع طلبية كيك' });
console.log(revenueCount + 1, 'revenue records,', expenseCount + 1, 'one-off expenses, 3 recurring');

await owner.post(`${B}/budgets`, { scope: 'category', categoryId: cats.marketing ?? cats.supplies, period: 'monthly', amount: 400000 });
await owner.post(`${B}/budgets`, { scope: 'category', categoryId: cats.maintenance, period: 'monthly', amount: 300000 });
await owner.post(`${B}/budgets`, { scope: 'payroll', period: 'monthly', amount: 6000000 });
await owner.post(`${B}/budgets`, { scope: 'total', period: 'monthly', amount: 32000000 });

// ---------- employee expense claims ----------
const claim = async (p, amount, key, description, daysAgo, submit = true) =>
  p.client.post(`${B}/employee-expenses`, { amount, categoryId: cats[key], description, spentOn: addDays(localToday, -daysAgo), businessPurpose: 'توصيل طلبيات', submit });
const c1 = await claim(by.driver, 45000, 'fuel', 'بنزين للسيارة', 20);
const c2 = await claim(by.driver, 15000, 'transport', 'أجرة تكسي لتوصيل كيك', 9);
await claim(by.cashier1, 12000, 'supplies', 'شريط للطابعة', 2);
await claim(by.baker1, 380000, 'equipment', 'ميزان رقمي جديد', 4);
await claim(by.driver, 30000, 'fuel', 'بنزين', 1, false);
await owner.post(`${B}/employee-expenses/${c1.id}/decide`, { action: 'approve' });
await owner.post(`${B}/employee-expenses/${c2.id}/decide`, { action: 'approve' });

// ---------- payroll: last month paid, this month in draft ----------
const lastMonthDay = addDays(`${localToday.slice(0, 7)}-01`, -10);
const prev = await owner.post(`${B}/payroll/runs`, { date: lastMonthDay });
await owner.post(`${B}/payroll/runs/${prev.id}/items`, { membershipId: by.baker1.id, kind: 'bonus', amount: 100000, description: 'مكافأة رمضان' }).catch(() => {});
await owner.post(`${B}/payroll/runs/${prev.id}/finalize`);
await owner.post(`${B}/payroll/runs/${prev.id}/pay`, {});
await owner.post(`${B}/payroll/runs`, { date: localToday });
console.log('Payroll: last month paid, this month in draft');

const { scanAlerts } = await import('../server/services/analytics.js');
await scanAlerts(pool).catch(() => {});
await app.outbox.flush();
await app.close();
await pool.end();

console.log(`
Demo ready. Sign in at ${config.appUrl} with password “${PASSWORD}”:
  Owner     ${OWNER}
  Manager   ${by.manager.email}
  Employee  ${by.cashier1.email}  (also hussein@, mustafa@, noor@, ahmed@demo.test)`);
