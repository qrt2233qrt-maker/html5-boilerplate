// The permission catalog for the whole platform. Owners always hold every
// permission. Managers and employees start from the defaults below, which an
// owner can change per role or per person.
//
// ownerOnly permissions can never be granted to anyone else. This is
// enforced here, not just hidden in the UI, so a manager can't give
// themselves owner powers (spec §2).

export const PERMISSIONS = [
  // Business and security
  { key: 'business.settings.manage', group: 'business', manager: false },
  { key: 'business.delete', group: 'business', ownerOnly: true },
  { key: 'security.manage', group: 'business', ownerOnly: true },
  { key: 'permissions.manage', group: 'business', ownerOnly: true },
  { key: 'owners.manage', group: 'business', ownerOnly: true },
  { key: 'records.hard_delete', group: 'business', ownerOnly: true },
  { key: 'audit.view', group: 'business', manager: false },

  // People
  { key: 'members.view', group: 'people', manager: true },
  { key: 'members.view_sensitive', group: 'people', manager: false },
  { key: 'members.invite', group: 'people', manager: false },
  { key: 'members.edit', group: 'people', manager: false },
  { key: 'members.suspend', group: 'people', manager: false },
  { key: 'members.terminate', group: 'people', manager: false },
  { key: 'roles.assign', group: 'people', ownerOnly: true },
  { key: 'departments.manage', group: 'people', manager: false },

  // Scheduling
  { key: 'schedules.view', group: 'scheduling', manager: true },
  { key: 'schedules.manage', group: 'scheduling', manager: true },
  { key: 'shift_requests.approve', group: 'scheduling', manager: true },
  { key: 'swaps.approve', group: 'scheduling', manager: true },
  { key: 'attendance.view', group: 'scheduling', manager: true },
  { key: 'attendance.manage', group: 'scheduling', manager: true },

  // Money
  { key: 'payroll.view', group: 'finance', manager: false },
  { key: 'payroll.manage', group: 'finance', manager: false },
  { key: 'employee_expenses.review', group: 'finance', manager: true },
  { key: 'employee_expenses.approve', group: 'finance', manager: true },
  { key: 'business_expenses.view', group: 'finance', manager: false },
  { key: 'business_expenses.manage', group: 'finance', manager: false },
  { key: 'revenue.view', group: 'finance', manager: false },
  { key: 'revenue.manage', group: 'finance', manager: false },
  { key: 'budgets.manage', group: 'finance', manager: false },
  { key: 'finance.view', group: 'finance', manager: false },

  // Reports and analytics
  { key: 'analytics.view', group: 'reports', manager: true },
  { key: 'reports.operational', group: 'reports', manager: true },
  { key: 'reports.financial', group: 'reports', manager: false },
  { key: 'reports.export', group: 'reports', manager: true },

  // Self-service (every role)
  { key: 'self.schedule', group: 'self', manager: true, employee: true },
  { key: 'self.requests', group: 'self', manager: true, employee: true },
  { key: 'self.swaps', group: 'self', manager: true, employee: true },
  { key: 'self.pay', group: 'self', manager: true, employee: true },
  { key: 'self.expenses', group: 'self', manager: true, employee: true },
  { key: 'self.profile', group: 'self', manager: true, employee: true },
];

export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));
const OWNER_ONLY = new Set(PERMISSIONS.filter((p) => p.ownerOnly).map((p) => p.key));

export const isOwnerOnly = (key) => OWNER_ONLY.has(key);

export function defaultAllowed(role, key) {
  const p = PERMISSIONS.find((x) => x.key === key);
  if (!p) return false;
  if (role === 'owner') return true;
  if (p.ownerOnly) return false;
  return !!p[role];
}

// roleOverrides and memberOverrides are Maps of key -> boolean.
export function resolvePermissions(role, roleOverrides = new Map(), memberOverrides = new Map()) {
  const out = new Set();
  for (const { key } of PERMISSIONS) {
    if (role === 'owner') {
      out.add(key);
      continue;
    }
    if (OWNER_ONLY.has(key)) continue;
    let allowed = defaultAllowed(role, key);
    if (roleOverrides.has(key)) allowed = roleOverrides.get(key);
    if (memberOverrides.has(key)) allowed = memberOverrides.get(key);
    if (allowed) out.add(key);
  }
  return out;
}

export async function loadPermissions(db, membership) {
  if (membership.role === 'owner') return resolvePermissions('owner');
  const [roleRows, memberRows] = await Promise.all([
    db.query('SELECT permission, allowed FROM role_permissions WHERE business_id = $1 AND role = $2',
      [membership.business_id, membership.role]),
    db.query('SELECT permission, allowed FROM membership_permissions WHERE membership_id = $1',
      [membership.id]),
  ]);
  const toMap = (rows) => new Map(rows.map((r) => [r.permission, r.allowed]));
  return resolvePermissions(membership.role, toMap(roleRows.rows), toMap(memberRows.rows));
}
