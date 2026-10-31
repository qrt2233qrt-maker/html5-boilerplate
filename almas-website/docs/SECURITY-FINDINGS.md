# ALMAS — Security Findings Register

Every finding records: description, severity, affected component, evidence, recommended fix and retest result.
A finding is closed only after a retest has been **executed** and its result recorded here.

Severity scale: Critical · High · Medium · Low · Info. Source for all current entries: code and schema review on 2026-10-31 (Phase 1). **No dynamic or penetration testing has been performed yet.**

---

### SEC-01 — Order items, prices and total are accepted from the browser
- **Severity:** High
- **Component:** `supabase/schema.sql` (`orders` table, policy `orders public insert`), `src/lib/repo.ts` (`createOrder`), `src/pages/Cart.tsx`
- **Description:** Any anonymous client can insert an order row with arbitrary `items` (including `price`) and an arbitrary `total`. The server never reads product prices or checks stock.
- **Evidence:** `schema.sql:82-83` (`items jsonb`, `total integer` written by the client); `schema.sql:89-90` (public insert, `with check (status = 'new')` only); `Cart.tsx:18,36` (total computed in the browser).
- **Impact today:** Orders are confirmed manually over WhatsApp, so a manipulated total would be visible to staff. It becomes exploitable once orders are processed or paid automatically.
- **Recommended fix:** Revoke direct inserts. Create orders only through a server-called transactional function that takes product/variant IDs and quantities, reads prices from the database, validates and decrements stock, and stores a price snapshot (Phase 2 §7.2).
- **Retest:** Not started.

### SEC-02 — Unauthenticated inserts with no rate limit or bot protection
- **Severity:** Medium
- **Component:** `orders` and `bookings` insert policies
- **Description:** The public anon key allows unlimited inserts into `orders` and `bookings`. A script can flood the tables and the admin view.
- **Evidence:** `schema.sql:70-71`, `schema.sql:89-90`.
- **Recommended fix:** Route submissions through server endpoints with per-IP and per-account rate limits plus Turnstile; remove public insert grants.
- **Retest:** Not started.

### SEC-03 — Upload validation is client-side only
- **Severity:** Medium
- **Component:** `src/lib/repo.ts` (`uploadImage`), storage policies in `schema.sql:102+`
- **Description:** Type and size checks and re-encoding happen in the admin's browser (`compressImage`). A holder of an admin session can upload any file type or size directly to the public bucket through the API. The bucket has no `allowed_mime_types` or `file_size_limit`.
- **Evidence:** `repo.ts:217` (client-side compress, then direct upload); bucket created without limits in `schema.sql`.
- **Recommended fix:** Server upload route with a size cap, MIME allow-list, magic-byte check and `sharp` re-encode; bucket-level type and size limits; originals in a private bucket.
- **Retest:** Not started.

### SEC-04 — Demo-mode admin credentials and flag in client code
- **Severity:** Medium (Low impact in practice: demo data is per-browser only, but the spec forbids placeholder security presented as real)
- **Component:** `src/lib/repo.ts`
- **Description:** When Supabase keys are absent, admin login compares against a password shipped in the JS bundle and stores an "admin" flag in `sessionStorage`.
- **Evidence:** `repo.ts:35` (`DEMO_ADMIN`), `repo.ts:115`.
- **Recommended fix:** Exclude demo mode from production builds entirely; the production build must fail if backend configuration is missing.
- **Retest:** Not started.

### SEC-05 — No security headers or Content-Security-Policy
- **Severity:** Medium
- **Component:** `vercel.json`
- **Description:** No HSTS, CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy or frame-ancestors.
- **Evidence:** `vercel.json:3-4` defines only `Cache-Control`.
- **Recommended fix:** Set headers in Next.js middleware with a nonce-based CSP; test the CSP in report-only mode before enforcing.
- **Retest:** Not started.

### SEC-06 — Single admin role; no RBAC or MFA
- **Severity:** Medium
- **Component:** `admins` table, `is_admin()`
- **Description:** Any row in `admins` grants full control over products, orders, bookings and storage. Admin sessions do not require MFA.
- **Evidence:** `schema.sql` (`is_admin()` used by all write policies).
- **Recommended fix:** Permission-based RBAC (`has_permission()`), with `aal2` required for admin permissions (Phase 2 §7.2).
- **Retest:** Not started.

### SEC-07 — No audit or security event logging
- **Severity:** Medium
- **Component:** Whole application
- **Description:** Logins, product changes, order status changes and permission changes are not recorded.
- **Recommended fix:** Append-only `audit_events` table written by definer functions, plus Supabase Auth logs.
- **Retest:** Not started.

### SEC-08 — Products readable without a published filter
- **Severity:** Low
- **Component:** policy `products public read` (`schema.sql:50-51`)
- **Description:** `using (true)` exposes every product row, including future drafts and internal fields.
- **Recommended fix:** Add `is_published`, restrict anon reads to published rows, and expose a view or column list without internal fields (cost price, notes).
- **Retest:** Not started.

### SEC-09 — RLS and storage policies never executed
- **Severity:** Info
- **Component:** `supabase/schema.sql`
- **Description:** The schema has not been applied to a real Supabase project, so no policy has been verified.
- **Recommended fix:** Automated RLS tests (pgTAP or a Supabase test harness) covering anon, customer, each admin role, and cross-customer access attempts.
- **Retest:** Not started.
