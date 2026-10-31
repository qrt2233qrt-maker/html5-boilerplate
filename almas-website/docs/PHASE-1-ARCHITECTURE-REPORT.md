# ALMAS (الماس) — Phase 1: Project Inspection & Architecture Report

| | |
|---|---|
| Spec | ALMAS Master E-Commerce Website Specification v1.0 |
| Phase | 1 — Existing project inspection (no application code changed in this phase) |
| Date | 2026-10-31 |
| Branch | `claude/relaxed-curie-k2n037` |
| Scope inspected | `almas-website/` (application), `supabase/schema.sql`, build output, deployment config |

This report states only what was verified by reading the code, running the build, or running a tool. Anything not verified is marked **Unverified** or **Decision needed**.

---

## 1. Summary

The current codebase is a **front-end prototype**, not a business platform. It has a strong visual layer and a working cart → WhatsApp flow, but it does **not** meet the specification's core requirements:

1. **No server layer.** The browser talks directly to Supabase. There is nowhere to recalculate prices, enforce stock, rate-limit, hold Instagram tokens, or validate uploads server-side (spec §4.4, §7.4, §7.8, §4.9).
2. **Order totals are trusted from the browser** (finding SEC-01, High).
3. **No customer accounts, no RBAC, no MFA, no audit log, no inventory history** (spec §4.6, §6, §7.1, §7.12).
4. **Fabricated content** is on the page: testimonials, customer counts and service claims (spec §4.7, §10).
5. **Performance misses the spec's targets** on a mobile profile: LCP 9.0 s, against a target of ≤ 2.5 s (§8).
6. **SEO limits.** As a client-rendered SPA, product pages exist for search engines only after JavaScript runs.

Recommendation: keep the data platform (Supabase/Postgres), move the front end to a **server-rendered framework with a real server boundary** (Next.js recommended), and rebuild the visual layer in the restrained direction the spec describes. Details and the decisions needed are in §7 and §9.

---

## 2. Verified project facts (Phase 1, items 1–9)

| # | Item | Verified finding |
|---|---|---|
| 1 | Project structure | Repository is a fork of `html5-boilerplate`. The store lives in `almas-website/` (61 source files, ~4,600 lines of TS/TSX). The repo root still holds unrelated boilerplate (`src/`, `dist/`, `test/`, `gulpfile.mjs`). |
| 2 | Framework | React 19 + TypeScript 5 + Vite 7, client-side SPA, React Router 7. Styling: Tailwind CSS 3. Animation: GSAP, Lenis, Three.js / React Three Fiber (3D hero). State: Zustand. |
| 3 | Backend | **None.** There is no server code. All data access is from the browser through `@supabase/supabase-js` (`src/lib/repo.ts`). |
| 4 | Database | Supabase Postgres, defined in `supabase/schema.sql` (tables: `admins`, `products`, `bookings`, `orders`; RLS enabled). **Unverified:** no Supabase project is connected yet; the schema has never been applied or tested against a live database. Without keys the app falls back to browser `localStorage` (demo mode). |
| 5 | Authentication | Admin only, via Supabase Auth email/password, gated by `is_admin()` (membership in `admins`). Demo mode uses a password hard-coded in the client bundle (SEC-04). No customer authentication exists. |
| 6 | Hosting | **Not deployed.** `vercel.json` and `public/_redirects` (Netlify) exist; neither has been used. A preview copy is published as a private claude.ai artifact. |
| 7 | Existing security controls | RLS on all four tables; admin writes require `is_admin()`; storage writes to `product-images` require `is_admin()`; CHECK constraints on text lengths and statuses. Client-side image re-encoding to WebP. Nothing else (no CSP or security headers, no rate limiting, no CAPTCHA, no audit log, no MFA). |
| 8 | Performance | See §4. Mobile LCP 9.0 s. Initial JS ≈ 160 KB gzip plus a lazy 3D chunk of ≈ 275 KB gzip. |
| 9 | Dependencies | `npm audit`: **0 known vulnerabilities** (run 2026-10-31, prod and dev). No Dependabot config for this folder. |
| — | Tests | **None.** No unit, integration, e2e, or RLS tests are committed. The Playwright checks run in earlier sessions were ad-hoc scripts and are not in the repo. |

---

## 3. Gap analysis against the specification

Legend: ✅ meets · 🟡 partial · ❌ missing · ⚠️ conflicts with spec

| Spec § | Requirement | Status | Notes |
|---|---|---|---|
| 2 | Restrained premium design; no excessive glow, gradients or animation | ⚠️ | The current design uses neon glows, gradient text, 3D hero, parallax and cinematic transitions. The spec asks for the opposite. |
| 2 | Logo usable for favicon, Instagram, packaging | 🟡 | An SVG diamond mark exists. It is not a designed identity system (no lockups, clear-space, mono and print versions). |
| 3 | Arabic RTL default | ✅ | Logical CSS properties throughout. |
| 3 | English LTR | ❌ | A dictionary structure exists (`src/i18n`); there is no English content, switcher, or `/en` routes. |
| 3 | Configurable currency, phone, delivery, tax | 🟡 | `src/config/site.ts` centralises some values. Delivery and tax are not modelled. |
| 4.1 | Homepage sections | 🟡 | Missing: search in the header, account button, best-sellers, offers, recommended, Instagram gallery, banners managed by admin. |
| 4.2 | Catalogue: pagination, comparison, stock filter | 🟡 | Has search, category, brand, price filter and sort. No pagination (all products are loaded at once), no comparison, no stock filter. |
| 4.3 | Product details: models, condition, warranty, reviews, Buy now | 🟡 | Has images, price, discount, specs, colours, stock and related products. No model variants, condition, per-product warranty, reviews, or Buy now. |
| 4.4 | Server-side total recalculation, stock validation | ❌ | Totals come from the browser (SEC-01). Stock is never checked or decremented. |
| 4.5 | Checkout: city/area, payment method, confirmation page | 🟡 | Collects name, phone, address and notes, then hands off to WhatsApp. No payment-method selection and no persistent order confirmation or tracking. |
| 4.6 | Customer accounts | ❌ | None. |
| 4.7 | About page, no invented claims | ❌ | No About page. Invented claims appear elsewhere (CONTENT-01). |
| 4.8 | Contact with spam protection | 🟡 | Contact goes through a WhatsApp link only. No email, form backend or spam protection. Instagram link is a placeholder (`https://instagram.com/`). |
| 4.9 | Instagram via official API | ❌ | Not integrated. |
| 5 | Product model: AR/EN names, SKU, barcode, condition, warranty, variants, published flag, updated date, inventory history | ❌ | The current model is single-language with no SKU, condition, warranty, variant or published fields, and no inventory history. |
| 6 | Admin dashboard: KPIs, categories, brands, reviews, banners, settings, security events, activity logs, RBAC | ❌ | Current admin: product CRUD with image upload, plus booking and order lists with status changes. Single role. |
| 6 | Order statuses and status history | 🟡 | Statuses exist (`new / confirmed / delivered / cancelled`). No `processing / shipped / returned`, and no history. |
| 7.1 | Auth hardening, MFA, rate limits, login logging | ❌ | Admin only, no MFA, no logging. |
| 7.2 | Server-side authorization, IDOR prevention | 🟡 | RLS covers admin vs public. No per-customer ownership model yet, because there are no customers. |
| 7.3 | DB security, backups, restore tests | 🟡 | RLS is present but untested. No backups configured; no project exists. |
| 7.4 | API rate limiting, request limits, CORS, logging | ❌ | No API layer exists. |
| 7.5 | XSS / CSP | 🟡 | React escapes output by default; no `dangerouslySetInnerHTML` is used. No CSP. |
| 7.6 | SQL injection | ✅ | Data access uses the parameterised Supabase query builder only; no string-built SQL. |
| 7.7 | CSRF | n/a now | Supabase JS uses bearer tokens, not cookies. Becomes relevant with cookie sessions in the target architecture. |
| 7.8 | Server-side upload validation | ❌ | Validation is client-side only (SEC-03). |
| 7.9 | Security headers | ❌ | Only a cache header is configured (SEC-05). |
| 7.10 | Secrets | ✅ / ⚠️ | Only the public anon key is used client-side (by design). Demo password is in the bundle (SEC-04). |
| 7.11 | WAF, DDoS, bot protection | ❌ | Nothing configured. |
| 7.12 | Security logging | ❌ | None. |
| 8 | Core Web Vitals targets | ❌ | LCP 9.0 s measured (§4). |
| 9 | Search: SKU and specs, typing suggestions, pagination | 🟡 | Client-side substring search over loaded products, with Arabic letter normalisation. |
| 10 | No fake reviews or notifications | ❌ | Six fabricated testimonials (CONTENT-01). |
| 11 | SEO: canonical, structured data, sitemap, alt, language | 🟡 | All present, but rendered client-side. The sitemap is static and has no product URLs. Product JSON-LD matches displayed data. |
| 12 | Backups, RPO/RTO | ❌ | Not configured. Decision needed. |
| 13 | Security testing | ❌ | Only `npm audit` has been run. |
| 14 | Tests, structured logging, centralised errors | ❌ | None. |

---

## 4. Performance measurement

**Tool:** Lighthouse 12, mobile profile (simulated throttling), production build (`npm run build` + `vite preview`), headless Chromium in this container. Run on 2026-10-31.

| Metric | Measured | Spec target |
|---|---|---|
| Performance score | 31 / 100 | — |
| First Contentful Paint | 5.2 s | — |
| **Largest Contentful Paint** | **9.0 s** | ≤ 2.5 s ❌ |
| Total Blocking Time | 153 s (see caveat) | — |
| **Cumulative Layout Shift** | **0.003** | ≤ 0.1 ✅ |
| Accessibility | 92 | — |
| Best practices | 100 | — |
| SEO | 100 | — |

**Caveat:** this container has no GPU, so the Three.js hero is rendered by a software WebGL implementation. That inflates Total Blocking Time far beyond what a real phone would show. INP cannot be measured in a lab run; it needs field data. The LCP finding does not depend on the GPU:

- The LCP element is the hero subtitle. It starts at `opacity: 0` and is revealed by a GSAP animation, so it cannot paint until the JS bundle, fonts and animation timeline have loaded.
- 11 font files are preloaded through CSS on the first page.
- Three.js (≈ 275 KB gzip) loads on the homepage for decoration only.

**Accessibility failures reported:** `color-contrast`, `aria-prohibited-attr`, `label-content-name-mismatch`.

A real field measurement (Vercel Speed Insights or the CrUX report) is needed after deployment. Lab numbers are a starting point, not proof.

---

## 5. Security findings (code review, not penetration tested)

Full register with severity, evidence, fix and retest status: [`SECURITY-FINDINGS.md`](./SECURITY-FINDINGS.md).

| ID | Severity | Title |
|---|---|---|
| SEC-01 | High | Order items, prices and total are accepted from the browser |
| SEC-02 | Medium | Unauthenticated inserts into `orders` and `bookings` with no rate limit or bot protection |
| SEC-03 | Medium | Image upload validation is client-side only; bucket has no type or size limits |
| SEC-04 | Medium | Demo-mode admin password and admin flag live in client code and `sessionStorage` |
| SEC-05 | Medium | No security headers or Content-Security-Policy |
| SEC-06 | Medium | Single admin role; no RBAC, no MFA enforcement |
| SEC-07 | Medium | No audit or security event logging |
| SEC-08 | Low | `products` is publicly readable without a published/unpublished filter |
| SEC-09 | Info | RLS policies and the storage policy have never been executed against a real database |

None of these has been exploited or tested dynamically. They come from reading the code and schema.

---

## 6. Content integrity issues (spec §4.7 and §10)

| ID | Location | Problem |
|---|---|---|
| CONTENT-01 | `src/data/seed.ts:365` | Six testimonials with invented names and quotes. **Must be removed.** Reviews should come only from verified purchases (spec §4.3). |
| CONTENT-02 | `src/i18n/ar.ts:26-28` | "+12K happy customers", "100% original", "30 minutes" are invented statistics. |
| CONTENT-03 | `src/data/seed.ts` (why-us, repair services) | "Certified technicians", "3/6-month warranty", "24-hour delivery", repair starting prices: none of these were supplied by the business. |
| CONTENT-04 | `src/config/site.ts:16-22` | Working hours and social links are placeholders. |
| CONTENT-05 | `src/data/seed.ts` (products) | Sample products, prices and specs are illustrative only. |

---

## 7. Proposed target architecture (Phase 2 preview — **decision needed**)

### 7.1 Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Web framework | **Next.js (App Router) + TypeScript** | Server rendering of catalogue and product pages for SEO and LCP. Server Actions and Route Handlers give a real server boundary for checkout, uploads, Instagram tokens and rate limiting. Locale routing for `/ar` and `/en`. Middleware for CSP nonces and headers. Existing React and Tailwind components carry over. |
| Hosting | **Vercel** | First-class Next.js support, edge network and CDN, managed TLS. Optionally Cloudflare in front for WAF and bot management (decision needed). |
| Database | **Supabase Postgres** | Already modelled. Row Level Security, Postgres transactions for stock and orders, managed backups on paid plans. |
| Auth | **Supabase Auth** | Established password hashing, email verification, password reset, TOTP MFA, assurance level (`aal2`) visible in JWT claims for RLS, built-in auth rate limits. No custom crypto. |
| Sessions | Supabase SSR helpers with HTTP-only, Secure, SameSite cookies | Makes CSRF relevant. Mitigated with SameSite cookies, origin checks on Server Actions, and CSRF tokens on any custom POST routes. |
| File storage | Supabase Storage, private bucket for originals, public bucket for derived images | Uploads go through a server route: size limit, MIME allow-list, magic-byte signature check, re-encode with `sharp` (strips metadata and any embedded payload), randomised names. Bucket-level `allowed_mime_types` and `file_size_limit` as a second layer. |
| Images | `next/image` + generated sizes (thumb, card, gallery) in WebP/AVIF | Cards never load originals. |
| Rate limiting | Upstash Redis (`@upstash/ratelimit`) **or** Vercel WAF rules | Decision needed. Both are external services with their own accounts. |
| Bot protection | Cloudflare Turnstile on register, login, contact and checkout | Free tier available; requires a Cloudflare account. |
| Search | Postgres full-text search (`tsvector`, Arabic and English configs) + `pg_trgm` for typing suggestions | No extra search engine until the catalogue needs one (spec §9). |
| Monitoring | Sentry (errors), Vercel Speed Insights (field Core Web Vitals), Supabase logs | Accounts needed. |
| CI | GitHub Actions: typecheck, lint, Vitest, Playwright, Semgrep, `npm audit`, Dependabot | |

### 7.2 Critical design points

- **Checkout:** `place_order(...)` runs as a Postgres function inside one transaction, called from the server with the customer's session. It reads current prices and discounts from the database, computes delivery by zone, locks product rows (`SELECT … FOR UPDATE`), rejects insufficient stock, decrements stock, writes `orders`, `order_items` (price snapshot), `order_status_history` and `inventory_movements`, and enforces an **idempotency key** against duplicate submission. The browser sends only product IDs, variant IDs and quantities.
- **RBAC:** tables `roles`, `permissions`, `role_permissions`, `user_roles`. A `has_permission('orders.update')` function is used inside RLS policies and every definer function. Admin permissions additionally require `aal2` (MFA verified). The UI hides controls, but the database decides.
- **Audit log:** append-only `audit_events` table. Rows are written only by definer functions; no `update` or `delete` grants for any application role.
- **Customer data isolation:** RLS `user_id = auth.uid()` on profiles, addresses and orders, plus tests that try to read another customer's order (IDOR).
- **Instagram:** Instagram Graph API through a Meta app. This requires an Instagram **Business or Creator** account linked to a Facebook Page. The long-lived token is stored server-side only and refreshed by a scheduled job; posts are cached in the database and served from there. No scraping.
- **Payments:** cash on delivery at launch. Online payment only through a provider with a documented merchant API. Iraqi options to **evaluate, not assumed available**: ZainCash, FIB, Qi Card and similar. Each needs a merchant account and its own integration review. Card data never touches ALMAS servers.

### 7.3 Migration strategy (non-destructive)

1. Create the Next.js app alongside the current app, in a new folder or a dedicated repository (decision needed).
2. Port components; remove the 3D hero, GSAP scroll effects and Lenis per the spec's design direction (decision needed).
3. Write new versioned SQL migrations (`supabase/migrations/`). The current `schema.sql` stays until replaced; no live data exists yet, so nothing needs to be preserved.
4. The current `almas-website/` stays untouched and working until the new app reaches feature parity, then is archived. **Nothing will be deleted without asking.**

---

## 8. Information needed from the business (blocking for content and configuration)

| Item | Needed for |
|---|---|
| Instagram account URL; whether it is (or can become) a Business/Creator account linked to a Facebook Page | §4.9 |
| Business email, exact shop address / Google Maps pin, real working hours | §4.8, structured data |
| Delivery zones (cities/areas) and fees; free-delivery rules if any | Checkout totals |
| Warranty policy per product type; product conditions sold (new / used / refurbished) | §4.3, §5 |
| Return and exchange policy | Order statuses, legal pages |
| Real facts for the About page (founding year, team, values), or approval to keep it minimal | §4.7 |
| Whether the **repair / maintenance service** stays in scope (it was in the original brief but is absent from spec v1.0) | Scope |
| Admin users and which role each holds | RBAC seed |
| Domain name | SEO, email, TLS |
| Recovery objectives: acceptable data loss (RPO) and downtime (RTO) | §12, hosting plan |
| Budget for paid services. Supabase's free plan does not provide the managed backups that §12 requires, and free projects are paused after a period of inactivity. Verify current pricing on supabase.com. | Hosting |
| Real product list with official images, SKU, prices | Catalogue |

---

## 9. Decisions requested before Phase 2

1. **Front-end architecture:** migrate to Next.js (recommended), or keep the Vite SPA and add Supabase Edge Functions as the server layer.
2. **Visual direction:** adopt the restrained direction from spec §2 (remove the 3D hero, glows and scroll effects), or keep the current look.
3. **Payment at launch:** cash on delivery only, or COD plus a named online provider.
4. **Repository:** move ALMAS to its own repository, or keep it in `almas-website/` inside the html5-boilerplate fork.
5. **Accounts to create** (owner-held, never shared with Claude): Supabase, Vercel, and optionally Cloudflare, Upstash, Sentry and Meta Developer.

---

## 10. Unresolved issues list

Maintained from this point on. Each item is closed only after verification.

| # | Issue | Owner | Status |
|---|---|---|---|
| U-1 | Architecture decision (§9.1) | Business | Open |
| U-2 | Design direction decision (§9.2) | Business | Open |
| U-3 | Payment methods (§9.3) | Business | Open |
| U-4 | Repository location (§9.4) | Business | Open |
| U-5 | Business information (§8) | Business | Open |
| U-6 | Remove fabricated content CONTENT-01..03 | Claude | Open; to be done in Phase 3 or earlier on request |
| U-7 | Security findings SEC-01..09 | Claude | Open; addressed by the Phase 2 design, verified in Phase 8 |
| U-8 | Field Core Web Vitals after deployment | Claude + Business | Blocked on deployment |
| U-9 | Repo root contains unrelated html5-boilerplate files | Business | Open (§9.4) |
