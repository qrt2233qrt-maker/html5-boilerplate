// Business settings, departments, locations and categories.
import { transaction } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import QRCode from 'qrcode';
import { DEFAULT_SETTINGS, auditB, business, settingsOf } from '../lib/context.js';
import { currentDoorCode } from '../lib/geo.js';

// Built-in categories. The first group matches the existing expenses app.
export const EXPENSE_CATEGORIES = [
  ['rent', 'Rent', 'إيجار', 'fixed', '🏢'],
  ['electricity', 'Electricity & generator', 'كهرباء ومولّدة', 'fixed', '⚡'],
  ['water', 'Water', 'ماء', 'fixed', '💧'],
  ['internet', 'Internet & phone', 'إنترنت وهاتف', 'fixed', '📶'],
  ['insurance', 'Insurance', 'تأمين', 'fixed', '🛡️'],
  ['software', 'Software & subscriptions', 'برامج واشتراكات', 'fixed', '💻'],
  ['licenses', 'Licenses', 'رخص', 'fixed', '📜'],
  ['taxes', 'Taxes', 'ضرائب', 'fixed', '🧾'],
  ['salaries', 'Salaries', 'رواتب', 'payroll', '👥'],
  ['supplies', 'Supplies', 'مستلزمات', 'operating', '🖇️'],
  ['equipment', 'Equipment', 'معدّات', 'operating', '🛠️'],
  ['maintenance', 'Maintenance & repairs', 'صيانة وتصليح', 'operating', '🔧'],
  ['transport', 'Transportation', 'نقل ومواصلات', 'operating', '🚕'],
  ['fuel', 'Fuel', 'وقود', 'operating', '⛽'],
  ['parking', 'Parking', 'مواقف', 'operating', '🅿️'],
  ['meals', 'Business meals', 'وجبات عمل', 'operating', '🍽️'],
  ['marketing', 'Marketing', 'تسويق', 'operating', '📣'],
  ['advertising', 'Advertising', 'إعلانات', 'operating', '📰'],
  ['cleaning', 'Cleaning', 'تنظيف', 'operating', '🧹'],
  ['professional', 'Professional services', 'خدمات مهنية', 'operating', '📑'],
  ['travel', 'Travel', 'سفر', 'operating', '✈️'],
  ['bankfees', 'Bank & transfer fees', 'رسوم مصرفية', 'operating', '🏦'],
  ['work_purchases', 'Work purchases', 'مشتريات العمل', 'operating', '🛒'],
  ['other', 'Other', 'أخرى', 'other', '📦'],
];
// Categories employees may claim as work expenses (spec §7).
const CLAIMABLE = new Set(['transport', 'fuel', 'parking', 'meals', 'supplies', 'equipment', 'work_purchases', 'travel', 'other']);

export const REVENUE_CATEGORIES = [
  ['sales', 'Sales', 'مبيعات', 'sale'],
  ['services', 'Services', 'خدمات', 'service'],
  ['other_income', 'Other income', 'إيرادات أخرى', 'other'],
  ['refunds', 'Refunds', 'مرتجعات', 'refund'],
  ['adjustments', 'Adjustments', 'تسويات', 'adjustment'],
];

export async function seedBusiness(db, businessId) {
  for (const [key, en, ar, kind, icon] of EXPENSE_CATEGORIES) {
    await db.query(
      `INSERT INTO expense_categories (business_id, key, name_en, name_ar, kind, icon, employee_claimable, builtin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) ON CONFLICT (business_id, key) DO NOTHING`,
      [businessId, key, en, ar, kind, icon, CLAIMABLE.has(key)]);
  }
  for (const [key, en, ar, kind] of REVENUE_CATEGORIES) {
    await db.query(
      `INSERT INTO revenue_categories (business_id, key, name_en, name_ar, kind, builtin)
       VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (business_id, key) DO NOTHING`, [businessId, key, en, ar, kind]);
  }
}

export async function seedAll(db) {
  const { rows } = await db.query(
    'SELECT b.id FROM businesses b WHERE NOT EXISTS (SELECT 1 FROM expense_categories c WHERE c.business_id = b.id)');
  for (const r of rows) await seedBusiness(db, r.id);
}

// ---------- business settings ----------

const PUBLIC_KEYS = ['id', 'name', 'kind', 'currency', 'currency_exponent', 'timezone', 'locale'];

export async function getSettings(app, req) {
  const b = await business(req);
  const out = Object.fromEntries(PUBLIC_KEYS.map((k) => [k, b[k]]));
  return { ...out, currencyExponent: b.currency_exponent, settings: settingsOf(b), defaults: DEFAULT_SETTINGS };
}

// Deep-merges allowed setting groups. Currency can't change once money is recorded.
export async function updateSettings(app, req, patch) {
  return transaction(app.db, async (db) => {
    const { rows: [b] } = await db.query('SELECT * FROM businesses WHERE id = $1 FOR UPDATE', [req.member.businessId]);
    const before = { name: b.name, timezone: b.timezone, currency: b.currency, settings: b.settings };
    if (patch.currency && (patch.currency !== b.currency || (patch.currencyExponent ?? b.currency_exponent) !== b.currency_exponent)) {
      const used = await db.query(
        `SELECT 1 FROM business_expenses WHERE business_id = $1 UNION ALL SELECT 1 FROM revenues WHERE business_id = $1
         UNION ALL SELECT 1 FROM pay_rates WHERE business_id = $1 UNION ALL SELECT 1 FROM employee_expenses WHERE business_id = $1 LIMIT 1`, [b.id]);
      if (used.rows[0]) throw conflict('currency_locked', 'The currency can\'t change after money has been recorded.');
    }
    if (patch.timezone) {
      const ok = await db.query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [patch.timezone]);
      if (!ok.rows[0]) throw badRequest('invalid_timezone', 'Unknown time zone.');
    }
    const settings = { ...(b.settings || {}) };
    for (const group of Object.keys(DEFAULT_SETTINGS)) {
      if (patch.settings?.[group]) settings[group] = { ...(settings[group] || {}), ...patch.settings[group] };
    }
    const { rows: [after] } = await db.query(
      `UPDATE businesses SET name = coalesce($2, name), timezone = coalesce($3, timezone), locale = coalesce($4, locale),
         currency = coalesce($5, currency), currency_exponent = coalesce($6, currency_exponent), settings = $7, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [b.id, patch.name ?? null, patch.timezone ?? null, patch.locale ?? null, patch.currency ?? null, patch.currencyExponent ?? null, JSON.stringify(settings)]);
    await auditB(db, req, { action: 'business.settings_updated', targetType: 'business', targetId: b.id, before, after: { name: after.name, timezone: after.timezone, currency: after.currency, settings: after.settings } });
    req._business = null;
    return getSettings(app, req);
  });
}

// ---------- departments and locations ----------

export async function listDepartments(app, req) {
  const { rows } = await app.db.query(
    `SELECT d.id, d.name, d.manager_membership_id AS "managerId", u.name AS "managerName", d.archived_at AS "archivedAt",
            (SELECT count(*) FROM memberships m WHERE m.department_id = d.id AND m.status = 'active') AS "memberCount"
       FROM departments d LEFT JOIN memberships mm ON mm.id = d.manager_membership_id LEFT JOIN users u ON u.id = mm.user_id
      WHERE d.business_id = $1 ORDER BY d.archived_at NULLS FIRST, lower(d.name)`, [req.member.businessId]);
  return rows;
}

async function checkManager(db, req, managerId) {
  if (!managerId) return;
  const { rows: [m] } = await db.query(
    'SELECT role FROM memberships WHERE id = $1 AND business_id = $2 AND status = \'active\'', [managerId, req.member.businessId]);
  if (!m || m.role === 'employee') throw badRequest('invalid_manager', 'Choose an active manager or owner.');
}

export async function saveDepartment(app, req, id, { name, managerId = null, archived }) {
  return transaction(app.db, async (db) => {
    await checkManager(db, req, managerId);
    let row;
    try {
      if (id) {
        const { rows: [before] } = await db.query('SELECT * FROM departments WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, req.member.businessId]);
        if (!before) throw notFound();
        ({ rows: [row] } = await db.query(
          `UPDATE departments SET name = coalesce($3, name), manager_membership_id = $4,
             archived_at = CASE WHEN $5::boolean IS NULL THEN archived_at WHEN $5 THEN coalesce(archived_at, now()) ELSE NULL END
           WHERE id = $1 AND business_id = $2 RETURNING *`, [id, req.member.businessId, name ?? null, managerId, archived ?? null]));
        await auditB(db, req, { action: 'department.updated', targetType: 'department', targetId: id, before: { name: before.name, managerId: before.manager_membership_id, archived: !!before.archived_at }, after: { name: row.name, managerId: row.manager_membership_id, archived: !!row.archived_at } });
      } else {
        ({ rows: [row] } = await db.query(
          'INSERT INTO departments (business_id, name, manager_membership_id) VALUES ($1, $2, $3) RETURNING *', [req.member.businessId, name, managerId]));
        await auditB(db, req, { action: 'department.created', targetType: 'department', targetId: row.id, after: { name } });
      }
    } catch (err) {
      if (err.code === '23505') throw conflict('duplicate_name', 'A department with this name already exists.');
      throw err;
    }
    return { id: row.id, name: row.name, managerId: row.manager_membership_id, archivedAt: row.archived_at };
  });
}

const locationOut = (r) => ({
  id: r.id, name: r.name, address: r.address, archivedAt: r.archived_at,
  latitude: r.latitude, longitude: r.longitude, radiusM: r.radius_m, doorMode: r.door_mode,
});

export async function listLocations(app, req) {
  const { rows } = await app.db.query(
    'SELECT * FROM locations WHERE business_id = $1 ORDER BY archived_at NULLS FIRST, lower(name)', [req.member.businessId]);
  return rows.map(locationOut);
}

export async function saveLocation(app, req, id, { name, address, archived, latitude, longitude, radiusM, doorMode }) {
  const db = app.db;
  // The position is set or cleared as a pair.
  const pos = latitude === undefined && longitude === undefined ? undefined : [latitude ?? null, longitude ?? null];
  if (pos && (pos[0] === null) !== (pos[1] === null)) throw badRequest('invalid_position', 'Give both latitude and longitude.');
  let row;
  if (id) {
    ({ rows: [row] } = await db.query(
      `UPDATE locations SET name = coalesce($3, name), address = coalesce($4, address),
         archived_at = CASE WHEN $5::boolean IS NULL THEN archived_at WHEN $5 THEN coalesce(archived_at, now()) ELSE NULL END,
         latitude = CASE WHEN $6::boolean THEN $7 ELSE latitude END, longitude = CASE WHEN $6::boolean THEN $8 ELSE longitude END,
         radius_m = coalesce($9, radius_m), door_mode = coalesce($10, door_mode)
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      [id, req.member.businessId, name ?? null, address ?? null, archived ?? null, !!pos, pos?.[0] ?? null, pos?.[1] ?? null, radiusM ?? null, doorMode ?? null]));
    if (!row) throw notFound();
  } else {
    ({ rows: [row] } = await db.query(
      `INSERT INTO locations (business_id, name, address, latitude, longitude, radius_m, door_mode)
       VALUES ($1, $2, $3, $4, $5, coalesce($6, 100), coalesce($7, 'screen')) RETURNING *`,
      [req.member.businessId, name, address ?? null, pos?.[0] ?? null, pos?.[1] ?? null, radiusM ?? null, doorMode ?? null]));
  }
  await auditB(db, req, {
    action: id ? 'location.updated' : 'location.created', targetType: 'location', targetId: row.id,
    after: { name: row.name, positionSet: row.latitude !== null, radiusM: row.radius_m, doorMode: row.door_mode },
  });
  return locationOut(row);
}

// The code to show at the door now, as text and as a QR image. Scanning it
// opens the clock page with the location and code filled in.
export async function doorCode(app, req, id) {
  const biz = await business(req);
  const { rows: [loc] } = await app.db.query('SELECT * FROM locations WHERE id = $1 AND business_id = $2 AND archived_at IS NULL', [id, biz.id]);
  if (!loc) throw notFound();
  const { code, validUntil, day } = currentDoorCode(loc, biz.timezone);
  const url = `${app.config.appUrl}/#/clock?l=${loc.id}&c=${code}`;
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { locationId: loc.id, locationName: loc.name, businessName: biz.name, mode: loc.door_mode, code, validUntil, day: day ?? null, url, qrSvg, positionSet: loc.latitude !== null };
}

// New secret: every code shown or printed so far stops working.
export async function resetDoorCode(app, req, id) {
  const { rowCount } = await app.db.query(
    'UPDATE locations SET door_secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, \'-\', \'\') WHERE id = $1 AND business_id = $2', [id, req.member.businessId]);
  if (!rowCount) throw notFound();
  await auditB(app.db, req, { action: 'location.door_code_reset', targetType: 'location', targetId: id });
  return { ok: true };
}

// ---------- categories ----------

export async function listCategories(app, req, type) {
  const table = type === 'revenue' ? 'revenue_categories' : 'expense_categories';
  const { rows } = await app.db.query(`SELECT * FROM ${table} WHERE business_id = $1 ORDER BY archived_at NULLS FIRST, builtin DESC, name_en`, [req.member.businessId]);
  return rows.map((c) => ({
    id: c.id, key: c.key, nameEn: c.name_en, nameAr: c.name_ar, kind: c.kind, icon: c.icon ?? null,
    employeeClaimable: c.employee_claimable ?? false, builtin: c.builtin, archivedAt: c.archived_at,
  }));
}

export async function saveCategory(app, req, type, id, input) {
  const table = type === 'revenue' ? 'revenue_categories' : 'expense_categories';
  const db = app.db;
  let row;
  if (id) {
    const extra = type === 'revenue' ? '' : ', icon = coalesce($7, icon), employee_claimable = coalesce($8, employee_claimable)';
    const params = [id, req.member.businessId, input.nameEn ?? null, input.nameAr ?? null, input.archived ?? null, input.kind ?? null];
    if (type !== 'revenue') params.push(input.icon ?? null, input.employeeClaimable ?? null);
    ({ rows: [row] } = await db.query(
      `UPDATE ${table} SET name_en = coalesce($3, name_en), name_ar = coalesce($4, name_ar),
         archived_at = CASE WHEN $5::boolean IS NULL THEN archived_at WHEN $5 THEN coalesce(archived_at, now()) ELSE NULL END,
         kind = CASE WHEN builtin THEN kind ELSE coalesce($6, kind) END${extra}
       WHERE id = $1 AND business_id = $2 RETURNING *`, params));
    if (!row) throw notFound();
  } else {
    const key = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (type === 'revenue') {
      ({ rows: [row] } = await db.query(
        'INSERT INTO revenue_categories (business_id, key, name_en, name_ar, kind) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [req.member.businessId, key, input.nameEn || input.nameAr, input.nameAr || input.nameEn, input.kind || 'other']));
    } else {
      ({ rows: [row] } = await db.query(
        `INSERT INTO expense_categories (business_id, key, name_en, name_ar, kind, icon, employee_claimable)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [req.member.businessId, key, input.nameEn || input.nameAr, input.nameAr || input.nameEn, input.kind || 'other', input.icon || '🏷️', !!input.employeeClaimable]));
    }
  }
  await auditB(db, req, { action: id ? 'category.updated' : 'category.created', targetType: `${type}_category`, targetId: row.id, after: { nameEn: row.name_en, nameAr: row.name_ar, archived: !!row.archived_at } });
  return (await listCategories(app, req, type)).find((c) => c.id === row.id);
}

// ---------- restaurant setup ----------
// Sections (departments) and categories a restaurant needs. Applying it is
// safe to repeat: anything already there (by name or key) is left alone.
export const RESTAURANT_SECTIONS = [['Kitchen', 'المطبخ'], ['Front of house', 'الصالة'], ['Delivery', 'التوصيل']];
export const RESTAURANT_EXPENSES = [
  ['ingredients', 'Ingredients & food stock', 'مواد غذائية ومكونات', 'operating', '🧀'],
  ['drinks_stock', 'Drinks stock', 'مخزون المشروبات', 'operating', '🥤'],
  ['packaging', 'Packaging & boxes', 'تغليف وعلب', 'operating', '📦'],
  ['cooking_gas', 'Cooking gas', 'غاز الطبخ', 'operating', '🔥'],
  ['delivery_fees', 'Delivery app commission', 'عمولة تطبيقات التوصيل', 'operating', '🛵'],
  ['food_waste', 'Food waste', 'هدر الطعام', 'operating', '🗑️'],
];
export const RESTAURANT_REVENUE = [
  ['dine_in', 'Dine-in sales', 'مبيعات الصالة', 'sale'],
  ['takeaway', 'Takeaway sales', 'مبيعات السفري', 'sale'],
  ['delivery_sales', 'Delivery sales', 'مبيعات التوصيل', 'sale'],
];

export async function seedRestaurant(db, businessId, locale = 'en') {
  const added = { sections: [], expenseCategories: 0, revenueCategories: 0 };
  for (const [en, ar] of RESTAURANT_SECTIONS) {
    const name = locale === 'ar' ? ar : en;
    const { rowCount } = await db.query(
      `INSERT INTO departments (business_id, name) SELECT $1, $2
        WHERE NOT EXISTS (SELECT 1 FROM departments WHERE business_id = $1 AND archived_at IS NULL AND lower(name) IN (lower($3), lower($4)))`,
      [businessId, name, en, ar]);
    if (rowCount) added.sections.push(name);
  }
  for (const [key, en, ar, kind, icon] of RESTAURANT_EXPENSES) {
    const { rowCount } = await db.query(
      `INSERT INTO expense_categories (business_id, key, name_en, name_ar, kind, icon, employee_claimable, builtin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) ON CONFLICT (business_id, key) DO NOTHING`,
      [businessId, key, en, ar, kind, icon, key === 'ingredients' || key === 'packaging']);
    added.expenseCategories += rowCount;
  }
  for (const [key, en, ar, kind] of RESTAURANT_REVENUE) {
    const { rowCount } = await db.query(
      `INSERT INTO revenue_categories (business_id, key, name_en, name_ar, kind, builtin)
       VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (business_id, key) DO NOTHING`, [businessId, key, en, ar, kind]);
    added.revenueCategories += rowCount;
  }
  await db.query('UPDATE businesses SET kind = \'restaurant\' WHERE id = $1', [businessId]);
  return added;
}

export async function applyRestaurant(app, req) {
  return transaction(app.db, async (db) => {
    const b = await business(req);
    const added = await seedRestaurant(db, b.id, b.locale);
    await auditB(db, req, { action: 'business.restaurant_setup', targetType: 'business', targetId: b.id, after: added });
    return { kind: 'restaurant', ...added };
  });
}

// ---------- opening hours and shift types ----------
// Changed by anyone who manages the schedule, not only the owner.
export async function saveHours(app, req, { opensAt, closesAt, shiftTypes }) {
  return transaction(app.db, async (db) => {
    const { rows: [b] } = await db.query('SELECT settings FROM businesses WHERE id = $1 FOR UPDATE', [req.member.businessId]);
    const before = settingsOf({ settings: b.settings }).hours;
    const keys = new Set();
    const types = shiftTypes.map((s, i) => {
      if (s.start === s.end) throw badRequest('invalid_shift_type', 'A shift can\'t start and end at the same time.');
      let key = (s.key || '').replace(/[^a-z0-9_]/g, '') || `shift${i + 1}`;
      while (keys.has(key)) key = `${key}_${i}`;
      keys.add(key);
      return { key, name: (s.name || '').trim(), start: s.start, end: s.end };
    });
    const hours = { opensAt, closesAt, shiftTypes: types };
    await db.query('UPDATE businesses SET settings = jsonb_set(coalesce(settings, \'{}\'::jsonb), \'{hours}\', $2::jsonb), updated_at = now() WHERE id = $1',
      [req.member.businessId, JSON.stringify(hours)]);
    await auditB(db, req, { action: 'schedule.hours_updated', targetType: 'business', targetId: req.member.businessId, before, after: hours });
    req._business = null;
    return hours;
  });
}
