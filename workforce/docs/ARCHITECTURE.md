# Workforce platform: architecture and roadmap

This document covers the ten steps that section 50 of the master specification
requires before implementation. It is the reference for every phase. Update it
when a decision changes.

---

## 1. What exists today

The repository holds two unrelated things.

| Part | What it is | Runtime |
| --- | --- | --- |
| `src/`, `dist/`, `gulpfile.mjs` | The upstream HTML5 Boilerplate template. It has no application code. | Static files, built with gulp/webpack |
| `expenses-app/index.html` | The live **Business Expenses** app, copied from the Claude artifact | Claude artifact runtime |

### The Business Expenses app

| Layer | How it works now |
| --- | --- |
| Frontend | One 93 KB HTML file with vanilla JS (no framework or build step), hand-written components, Arabic/English with full RTL, and an IQD currency format |
| Backend | None. All logic runs in the browser. |
| Database | The artifact's shared document store (`claude.use("db")`), a Firestore-like tree with path rules: `expenses/{self}`, `members`, `approvals`, `config/*`, `payroll/*` |
| Authentication | Claude accounts. The person opening the artifact is the user. |
| Roles | The artifact's share levels: owner = artifact owner, admin = Editor, member = Contributor |
| Files | Receipts are compressed in the browser to JPEG under 180 KB and stored as base64 inside database documents |
| Exports | CSV through the `downloads` capability |
| Deployment | Hosted by Claude at the artifact URL |

Features it already has: expense logging, 14 categories, receipt photos,
monthly budgets with alerts at 80% and 100%, reports and charts, CSV export,
an approval flow (submitted → approved/rejected → reimbursed, with admin
expenses approved automatically), and an owner-only payroll section
(employees, base pay + allowances − deductions, monthly pay runs).

### Why it can't host this specification

The specification requires things the artifact runtime cannot provide:

- server-side permission checks (§30), beyond path-level read and write rules
- its own passwords, email and SMS verification, OTP, 2FA and sessions (§17, §18)
- financial calculations on the backend (§48); today all totals are computed in the browser
- rate limiting, background jobs, scheduled recurring expenses and notifications
- relational integrity (foreign keys), an immutable audit log, and backups (§28, §44)
- separate businesses with isolated data (§36)

**Decision:** build a real backend with PostgreSQL in `workforce/`. The current
artifact keeps running unchanged until the data importer (Phase 8) moves its
records across. Nothing that works today is removed.

---

## 2. Technology choices

| Concern | Choice | Reason |
| --- | --- | --- |
| Runtime | Node.js 22 (already required by the repo) | One language front and back. The repo already uses Node tooling. |
| HTTP | Fastify | Fast, with built-in JSON-schema validation for every request body (§30 input validation) |
| Database | PostgreSQL 16 | Relational, transactional, `NUMERIC`, row-level locking, mature backups |
| DB access | `pg` with hand-written parameterised SQL | Every query is parameterised (SQL injection), with no ORM to hide what runs |
| Passwords | argon2id (`argon2`) | The current OWASP recommendation |
| Sessions | Opaque random tokens in an `HttpOnly` cookie, stored hashed | Revocable (logout everywhere), unlike stateless JWTs |
| Frontend | Vanilla ES modules, no build step | Matches the existing app and reuses its components and design system directly. Revisit at Phase 11 if the page count makes a framework worth it. |
| Charts (Phase 11) | Small hand-written SVG charts (`web/js/charts.js`) | Chart.js was the plan; three chart types turned out to need under 300 lines, with no dependency, a strict CSP, RTL, a table view per chart and a validated colour-blind-safe palette |
| Tests | Mocha (already in the repo) against a real PostgreSQL | Authorisation bugs hide in SQL, so tests use the real database |
| Email | SMTP (nodemailer) or the dev outbox | Works with any provider |
| SMS | Twilio REST or the dev outbox | Configured by environment variables |

---

## 3. What can be reused

From `expenses-app/index.html`:

- **Design system:** colour tokens with light and dark themes, motion tokens with reduced-motion handling, the banknote hero card, bottom sheet, toasts, skeletons, keyed animated lists, count-up numbers, animated bars
- **Arabic/English strings and RTL handling**, locale-aware number and date formatting, and IQD formatting. The current users work in Arabic, so the new platform is bilingual from day one.
- **Domain model:** the 14 categories (including Iraq-specific ones such as generator), the approval states, budget thresholds, the payroll formula, payment methods (cash, card, bank transfer, mobile wallet)
- **Client-side receipt compression** (it reduces upload size; the server still validates)
- **CSV export conventions** (UTF-8 BOM so Excel reads Arabic correctly)
- **The data itself:** an importer (Phase 8) maps artifact records into the new tables

---

## 4. What needs to be added

Everything in the specification that the artifact doesn't do: accounts with
passwords and verification, roles and granular permissions, separate
businesses, departments, employee profiles, shifts, schedules, requests,
swaps, attendance, hourly and overtime payroll, employee-versus-business
expense separation, revenue, P&L, the analytics centre, notifications,
PDF/Excel reports, an audit log, budgets across all spending, smart alerts,
global search and backups.

### Additions not in the specification, and why

| Addition | Why it's necessary |
| --- | --- |
| **CSRF token** on every state-changing request | Cookie sessions are open to cross-site request forgery. SameSite alone isn't enough for older browsers. |
| **Append-only audit log**, enforced by a database trigger | An audit log an admin can edit can't be trusted (§28) |
| **Locked payroll periods** | Once a pay period is paid, editing it would silently change past reports. Corrections are posted as adjustments. (accounting integrity, §48) |
| **Reversals instead of edits for financial records** | §48 asks for transaction history. Each change to a posted amount creates a linked history row. |
| **Idempotency keys** on financial POSTs | A retried request on a weak mobile connection must not record an expense twice |
| **Money as integer minor units** (`BIGINT`) plus a currency exponent per business | No floating-point errors (§48). IQD has 0 decimals and USD has 2. |
| **UTC storage plus a time zone per business** | Shifts that cross midnight or a DST change must calculate the right hours |
| **Outbox for emails and SMS** | A provider outage must not lose an invitation or verification. Messages are queued and retried. |
| **2FA recovery codes** | Without them, a lost phone locks the owner out of their business (§17, account recovery) |
| **Tenant-isolation tests** | §36: one business's data must never appear in another's. This is checked on every endpoint. |
| **Request IDs in logs and error responses** | Users see a friendly message and support can find the exact server log (§43) |
| **Arabic/RTL from day one** | The existing users work in Arabic |
| **Database migrations** | The schema will change across 16 phases without losing data |

---

## 5. Database design

Conventions:

- Primary keys are `uuid`. Every business-owned table has `business_id` with a foreign key, and every query filters by it.
- `created_at` and `updated_at` are `timestamptz`, stored in UTC.
- Important records are soft-deleted with `archived_at` (§21). Hard deletes are owner-only and audited.
- Money is stored as `BIGINT` minor units with a `currency char(3)`. Rates use `NUMERIC(12,4)`.
- History tables keep the previous state (shifts, pay rates, financial records).
- Indexes cover `(business_id, <date>)` for every list, report and chart query.

| Table | Phase | Purpose |
| --- | --- | --- |
| `businesses` | 1 | Name, currency, currency exponent, time zone, locale, settings |
| `users` | 1 | A global identity: email, phone, argon2id hash, verification timestamps, 2FA |
| `memberships` | 1 | Links a user to a business with a role (`owner`/`manager`/`employee`) and status (`active`/`suspended`/`terminated`/`archived`). This is the spec's "employees/managers": one person can belong to several businesses. |
| `role_permissions` | 1 | The owner's overrides of default permissions for each role |
| `membership_permissions` | 1 | Per-person grants or denials (for example, one manager allowed to see payroll) |
| `invitations` | 1 | Token hash, role, intended profile, expiry, accepted/revoked |
| `verification_tokens` | 1 | Email codes, SMS OTP, password reset and 2FA login challenges, with expiry and attempt counters |
| `sessions` | 1 | Token hash, CSRF token, device, IP, last seen, expiry, revoked |
| `rate_limits` | 1 | Fixed-window counters per key (IP, identifier) |
| `audit_logs` | 1 | Actor, action, target, before/after, IP, user agent. Append-only. |
| `notifications` | 1 (table), 12 (features) | In-app notifications per user |
| `outbound_messages` | 1 | Email/SMS outbox with status and retries |
| `departments` | 2 | Name, manager, archived |
| `employee_profiles` | 2 | Employee number, job title, department, manager, start date, pay type, contact details (encrypted), emergency contact |
| `pay_rates` | 2 | Rate history with effective dates. A rate is never overwritten. |
| `documents` | 2 | Private file metadata. Files live in private storage and are served only through permission-checked endpoints (§35). |
| `locations`, `schedules`, `shifts` | 3 | Published timetables. Shifts store start/end in UTC, breaks, department and location. |
| `shift_history` | 3 | Every change: old values, new values, who, when, why, approval status (§4) |
| `availability` | 3 | Employee unavailability, used for swap and schedule validation |
| `shift_requests` | 4 | Change, time-off, offer and pickup requests with status |
| `shift_swaps` | 4 | Two-party swap: offer, counterparty response, approval, applied |
| `attendance` | 5 | Clock in/out, breaks, source, manager adjustments with history |
| `pay_periods`, `payroll_runs`, `payroll_items` | 6 | Period, status (draft → approved → paid → locked), line items (base, overtime, bonus, deduction, reimbursement) |
| `employee_expenses` | 7 | Submitted work expenses with status flow and receipt document |
| `approval_rules`, `approvals` | 7 | Configurable multi-step approvals (§34) |
| `expense_categories` | 8 | Built-in and custom categories, fixed or operating |
| `business_expenses`, `recurring_expenses` | 8 | Ledger plus recurrence rules (daily → yearly, custom) |
| `revenue_categories`, `revenues` | 9 | Income, refunds and adjustments |
| `budgets` | 10 | Per category and period. Payroll is a category. |
| `alert_rules`, `alerts` | 11 | Smart-alert thresholds and fired alerts |
| `report_jobs` | 13 | Background PDF/Excel generation |

---

## 6. API design

- REST/JSON under `/api`. Everything business-specific lives under
  `/api/b/:businessId/…`, where the server checks membership, active status and
  the specific permission on **every** request.
- Unsafe methods (POST, PUT, PATCH, DELETE) require the `X-CSRF-Token` header.
- Errors look like `{ "error": { "code", "message", "requestId" } }`. Messages
  are user-safe and never contain stack traces or SQL (§43).
- Lists use limit and cursor pagination, filters and sorting allow-listed per endpoint (§42).
- Every request body is validated by a JSON schema with `additionalProperties: false`.

Phase 1 endpoints:

| Method and path | Purpose |
| --- | --- |
| `POST /api/auth/register` | Create a business and its owner (can be turned off with `ALLOW_BUSINESS_SIGNUP=false`) |
| `POST /api/auth/login`, `POST /api/auth/login/2fa` | Sign in with email or phone and a password, then 2FA if enabled |
| `POST /api/auth/logout`, `POST /api/auth/logout-all` | End this session, or every session |
| `GET /api/auth/me` | Current user, businesses, effective permissions, CSRF token |
| `POST /api/auth/verify/{email,phone}/request`, `POST /api/auth/verify/{email,phone}` | Send and confirm verification codes |
| `POST /api/auth/password/forgot`, `POST /api/auth/password/reset`, `POST /api/auth/password/change` | Password recovery and change |
| `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id` | List devices and sign one out |
| `POST /api/auth/2fa/setup`, `POST /api/auth/2fa/enable`, `POST /api/auth/2fa/disable` | Authenticator-app 2FA with recovery codes |
| `GET /api/invitations/:token`, `POST /api/invitations/accept` | Accept an invitation and set a password |
| `GET/POST /api/b/:bid/invitations`, `POST …/:id/resend`, `POST …/:id/revoke` | Invite employees and managers (owner) |
| `GET /api/b/:bid/members` | Team list (paginated, searchable) |
| `POST /api/b/:bid/members/:mid/role` | Make manager or remove manager (owner) |
| `POST /api/b/:bid/members/:mid/{suspend,reactivate}` | Suspend or reactivate access |
| `GET/PUT /api/b/:bid/permissions`, `PUT /api/b/:bid/members/:mid/permissions` | Role defaults and per-person permission overrides (owner) |
| `GET /api/b/:bid/audit-logs` | Audit history (owner, or managers if granted) |

Later phases add `/api/b/:bid/{departments,employees,shifts,schedules,
shift-requests,swaps,attendance,payroll,expenses,business-expenses,revenue,
budgets,reports,analytics,search,notifications,settings}` following the same
rules.

---

## 7. Frontend pages and components

A single shell app served from `web/` with role-based navigation. The mobile
bottom bar holds the most-used actions for each role (§38, §39).

| Role | Pages |
| --- | --- |
| Everyone | Sign in, 2FA, accept invitation, verify email/phone, forgot/reset password, profile, security (sessions, password, 2FA), notifications |
| Employee | Today, My schedule, Requests and swaps, My pay, My expenses (+ Add expense), Profile |
| Manager | Today's staffing, Schedule builder, Approvals inbox (requests, swaps, expenses), Attendance, Team, Department reports |
| Owner | "How is my business doing?" dashboard, Finance (expenses, revenue, P&L, budgets), Analytics centre, Payroll, Team, Reports, Audit log, Settings (business, departments, permissions, payroll, categories, approvals, notifications, authentication) |

Shared components come from the existing app: sheet, toast, skeleton,
animated list, stat tile, banknote hero card and bars. New ones: data table
(sort, filter, paginate), confirm dialog with typed confirmation for
destructive actions, date-range picker, chart card, status pill, empty and
error states.

---

## 8. Security changes

Everything in §30, applied as follows.

- **Authentication:** argon2id hashes, opaque session tokens stored as SHA-256, `HttpOnly` + `Secure` + `SameSite=Lax` cookies, idle and absolute session expiry, revocation for one device or all, optional TOTP 2FA with hashed recovery codes, and all sessions revoked on password reset.
- **Verification:** 6-digit codes stored hashed, 10-minute expiry, 5 attempts, resend throttling, and generic responses so accounts can't be discovered by guessing.
- **Authorisation:** server-side permission resolution on every request. Owner-only powers (business deletion, owner management, permission management, security settings, hard deletes) can't be delegated in code, so a manager can't grant themselves owner rights. Every query is filtered by business.
- **Rate limiting:** stored in Postgres so it works across several server instances, applied per IP and per account identifier.
- **Input and output:** JSON-schema validation; parameterised SQL; HTML-escaped output in the frontend (no `innerHTML` with user data unescaped); a strict Content-Security-Policy through helmet.
- **CSRF:** a per-session token, required for every unsafe method.
- **Files (Phase 2/7):** private storage, MIME sniffing plus extension allow-list, size limits, random object names, downloads only through permission-checked endpoints.
- **Encryption:** TLS in transit; AES-256-GCM for 2FA secrets and sensitive profile fields; encrypted database backups.
- **Audit:** append-only `audit_logs`, protected by a trigger, visible only to owners or roles granted `audit.view`.
- **Backups (Phase 16):** nightly `pg_dump` plus an uploads archive, verified and kept 14 days and 12 months (`scripts/backup.sh`), restore into an empty database only (`scripts/restore.sh`). Off-server copies and point-in-time recovery depend on the host; see [DEPLOY.md](DEPLOY.md#backups).

---

## 9. Roadmap

Each phase ships with migrations, API, UI, tests and an update to this document.

| # | Phase | Main deliverables | Status |
| --- | --- | --- | --- |
| 1 | Authentication, users, roles, permissions | Registration, invitations, verification, sign-in, 2FA, sessions, password recovery, permission engine, make/remove manager, suspend, audit foundation, Arabic/English shell UI | **Done** |
| 2 | Employee management | Departments, profiles, pay-rate history, documents, termination flow (disable sign-in, cancel future shifts, keep history), archive vs delete | **Done** |
| 3 | Schedules and shifts | Timetables, shift assignment, shift history, availability, overlap and hour-limit checks | **Done** |
| 4 | Shift requests and swaps | Change, time-off, offer and pickup requests; the two-party swap workflow with validation | **Done** |
| 5 | Attendance | Clock in/out, breaks, missed shifts, adjustments with history | **Done** |
| 6 | Payroll | Pay periods, hourly/salaried/overtime, bonuses, deductions, reimbursements, paid/pending/review status, locked periods | **Done** |
| 7 | Employee expenses | Submission, receipts, configurable approval workflow, reimbursement into payroll | **Done** |
| 8 | Business expenses | Ledger, categories, recurring expenses, **importer from the current expenses app** | **Done** |
| 9 | Revenue | Income, refunds, adjustments | **Done** |
| 10 | Profit and loss, budgets | Server-calculated P&L, labour cost, budget vs actual | **Done** |
| 11 | Analytics and charts | Owner dashboard, analytics centre, drill-downs, date filters, smart alerts | **Done** |
| 12 | Notifications | In-app, email and SMS for each event in §22, with preferences | **Done** |
| 13 | Reports and export | All §27 reports; CSV, Excel and PDF; background jobs | **Done** |
| 14 | Audit log UI | Search and filter audit history, plus coverage for every phase | **Done** |
| 15 | Security hardening | Threat review, penetration-test checklist, dependency audit, encryption of sensitive fields | **Done** |
| 16 | Testing, performance, deployment | Load tests, indexes review, backups, CI, production hosting | **Done** |

### Phase 1 notes

- Delivered as listed above, with 27 server tests and a browser walkthrough at phone and desktop sizes in both languages.
- Left for later phases on purpose: changing your own email or phone (Phase 2 profile), notification preferences and email/SMS fan-out for in-app notifications (Phase 12), sign-in history shown to the user (Phase 14).
- Hosting: see [DEPLOY.md](DEPLOY.md).

### Phases 2–16 notes

- All sixteen phases are built: 65 server tests at the time (84 with the restaurant additions), a browser walkthrough of every screen for all three roles (desktop in English, phone in Arabic), and interactive checks of the main workflows (swap, clock-in, claim and approval, adding shifts against the rules, drill-down, payroll, export, search).
- **Approvals (Phase 7)** are one configurable rule rather than a general rule builder: a manager approves employee expenses, and claims above an owner-set amount also need the owner. The `approvals` table records every step, so more steps can be added later without a migration.
- **PDF (Phase 13)** comes from the browser's print dialog with a print stylesheet. CSV and Excel files are generated on the server in the background.
- **Payroll (Phase 6)** calculates gross pay, overtime, bonuses, deductions and repayments. It does not calculate taxes or social security, or send money.
- **Importer (Phase 8)** reads the old app's own "Export CSV" file, or a fuller JSON format that also includes salary records. Receipt photos aren't in the CSV and stay in the old app.
- **Performance (Phase 16):** indexes reviewed (`003_performance.sql`); on six months of demo data the heaviest endpoints answer in under 25 ms at the 95th percentile.
- **Deployment (Phase 16):** a Dockerfile (non-root, health check), Docker Compose with PostgreSQL and nightly backups, and [DEPLOY.md](DEPLOY.md). Hosting itself still has to be chosen and paid for.
- **Security (Phase 15):** see [SECURITY.md](SECURITY.md) for the controls, the review findings and the pre-launch checklist.

### Restaurant additions (PizzaRita)

Asked for after the sixteen phases, for a restaurant with kitchen, front of
house and delivery drivers (`004_restaurant.sql`, `005_sections.sql`):

- **Clock-in zone** (`server/lib/geo.js`, `services/attendance.js`, `web/js/clock.js`): each location has a position, a radius and a secret. The door screen (`#/door`) shows a QR code linking to `#/clock?l=<location>&c=<code>`, with a 6-digit code that changes every minute (the previous minute is still accepted), or a daily code to print. `settings.attendance.method` picks the proof: `qr` (the code, plus the position when `checkLocation` is on), `gps` (no code; the phone's accuracy ≤ 150 m and its distance to the nearest location ≤ radius plus up to 30 m of the accuracy) or `either` (default: whichever the request carries). New locations get a 200 m radius. Errors: `zone_required`, `invalid_door_code`, `location_needed`, `location_inaccurate`, `outside_zone` (with the distance).
- **Pay frequency per person:** `pay_rates.frequency` (empty = the business default). A payroll run is for one frequency; a day belongs to the run whose frequency the person's rate has that day, and `payroll_statements.days` records exactly which days each statement paid, so changing someone's frequency never pays a day twice or skips one. Hours and trips recorded before someone's first pay rate are paid at that first rate; a salary runs only from its effective date.
- **Per-trip pay:** pay type `per_trip`; managers enter each driver's trips per day (`delivery_trips`, history kept, locked once paid); payroll adds a `trips` line (trips × the rate that day).
- **Chat** (`services/chat.js`, `web/js/pages/chat.js`): `chat_threads` (one `team` thread per business, one `direct` thread per pair), `chat_messages`, `chat_reads` for unread counts. The page polls every 4 seconds while a conversation is open (16 when the tab is hidden) and the unread badge every 30 seconds; WebSockets weren't needed at this size. A message can reference a shift request (`ref_type = 'shift_request'`), only in a private chat between the requester and someone else.
- **Sections:** departments are the restaurant's sections. `GET /analytics/sections` sums business expenses tagged to a section, approved staff claims and payroll (base, overtime, trips, bonuses, adjustments) by section. Statements and claims store the section the person was in at the time (filled in by a trigger), so moving someone doesn't rewrite past months. Sales by channel are the revenue categories.
- **Restaurant preset:** `businesses.kind`; `POST /setup/restaurant` adds the sections and categories and can be repeated safely.

### Later additions (October 2026)

- **Timetable** (`GET /timetable`, `web/js/pages/timetable.js`): every member sees the published shifts of the whole team (names, times, sections only — no notes, pay or contacts), by day, week or month. The signed-in person's shifts use the accent colour and everyone else shares one colour. Tapping a colleague's future shift starts a swap (`POST /swaps`) or a private chat.
- **Opening hours and shift types** (`settings.hours`, `PUT /schedule/hours`, permission `schedules.manage`): opens 04:00, closes 02:00 (a closing time at or before opening means after midnight), with Morning 04:00–15:00 and Night 15:00–02:00 by default. Used to pre-fill new shifts, to name shifts on the timetable and as the day view's span.
- **QR clock-in**: `web/js/clock.js` scans the door QR with `BarcodeDetector` or, where missing, jsQR (served from `node_modules` at `/vendor/jsQR.js`, so the CSP stays `script-src 'self'`). `settings.attendance.checkLocation` (default on, used in `qr` mode) and `typedCode` (default off) let the owner rely on the QR alone or allow typing the code. In `gps` and `either` modes the clock sheet offers "Use my location", which sends the position without a code.
- **Payroll** (`006_payroll_plus.sql`): `pay_components` (monthly allowance/deduction, spread over the days paid), `pay_advances` (instalments as `advance` items, capped at what the payroll leaves to pay), payslips (`GET /payroll/runs/:id/payslips/:membershipId`), and `payroll_corrections`: the owner can reopen a paid payroll with a reason (claims it repaid become owed again, statements go back to pending, affected people are notified); finalizing again records the new total.
- **Expenses** (`007_expenses_plus.sql`): quantity, unit and unit price (amount = quantity × unit price), `paid`/`due_on`/`paid_on` for bills on credit (`GET /bills`, `POST /business-expenses/:id/pay`), and `GET /suppliers` (spend per supplier and the latest unit price against the one before).
- **Free messaging**: with `EMAIL_TRANSPORT`/`SMS_TRANSPORT` = `none` (the production default) invitations and password resets are one-time links shared by hand; see SECURITY.md.

### Importing the current expenses app (Phase 8)

The live artifact's data differs slightly from the expense skill's reference
model, so the importer must accept both shapes:

- Approvals are stored at `approvals/<uid>__<expenseId>` (a flat collection), not `approvals/items/...`.
- Admin-created expenses are marked with `auto: true` on the approval record, not `autoApproved` on the expense.
- Receipts are base64 JPEGs in `expenses/<uid>/receipts/<expenseId>`. Neither import format carries them, so they stay viewable in the old app.
- People are Claude account ids. Imported expenses become business expenses with the person's name in the notes, rather than claims tied to members, because the old app's people don't map one-to-one to invited members.
- Amounts are already integer IQD with 0 decimals, which maps directly to `BIGINT` minor units.

As built (`server/services/importer.js`, Settings → Import):

- **CSV** — the old app's "Export CSV" file as-is: `{ "csv": "<file text>" }`. Rows have no ids, so each row's import reference is a hash of its contents plus a counter for identical rows. Categories are matched by their English name.
- **JSON** — `{ expenses: [{ uid, id, amount, categoryId, date, vendor, method, note }], approvals: { "<uid>__<id>": { status } }, payrollRuns: { "YYYY-MM": { lines: { <employeeId>: { amount, date, method } } } }, payrollEmployees: { <employeeId>: { name } }, people: { <uid>: name } }`, for a fuller export that includes salary records (imported into the Salaries category).
- Either way, rejected expenses are skipped, unknown categories go to "Other" and are listed in the result, and re-importing adds nothing twice.
