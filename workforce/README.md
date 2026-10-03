# Workforce

Workforce management, an employee portal, business operations and financial
analytics in one app, with separate Owner, Manager and Employee access. It
grows out of the Business Expenses app in [`../expenses-app`](../expenses-app),
whose records can be imported (Settings → Import).

Arabic (default) and English, right-to-left layout, phone and desktop, light
and dark themes.

- **Design and decisions:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): inspection of the existing app, database and API design, and the 16-phase roadmap (all phases built).
- **Security:** [docs/SECURITY.md](docs/SECURITY.md): controls, threat review and a pre-launch checklist.
- **Running it in production:** [docs/DEPLOY.md](docs/DEPLOY.md): Docker, configuration, backups and restore.

## What it does

| Area | What works |
| --- | --- |
| Accounts and access | Business sign-up creates the owner. Invitations with a one-time link, so nobody shares passwords: sent on WhatsApp by you for free, or by email/SMS if you connect a provider. Forgotten passwords: a one-time reset link from the owner or manager. Email and phone verification, sign-in with optional authenticator-app 2FA and recovery codes, device list and remote sign-out, password reset. 41 permissions the owner can turn on or off per role or per person; owner-only powers can't be delegated. |
| People | Profiles, departments with managers (a department manager sees only their people), locations, pay-rate history with effective dates, private documents, encrypted personal details and emergency contact. Make or remove a manager, suspend, end employment (cancels future shifts, keeps all history), archive, or permanently delete only when no records must be kept. |
| Timetable | One timetable for everyone by day, week or month: your shifts in your colour, the team in one shared colour, shift names (Morning, Night). Tap a colleague's shift to ask them to swap or to message them. |
| Scheduling | Opening hours (4am–2am by default) and the usual shifts (Morning 04:00–15:00, Night 15:00–02:00), changeable by the owner or a manager; one tap fills in a shift's times. Week grid with drafts and publishing, copy last week, open shifts, unavailability. Rules checked on every change: overlaps, rest between shifts, weekly hours, shift length, time off. Every change keeps history (who, when, why, before and after). |
| Requests and swaps | Change and time-off requests, giving a shift away, and two-person swaps (colleague accepts, then a manager approves), each re-validated against the rules when approved. |
| Attendance | Clock in and out with breaks, manager corrections with history, missed shifts and lateness, locked once the day is paid. **Clock-in at the restaurant:** the owner chooses how staff prove they are at work: **QR or location** (default), **QR only**, or **location only**. QR means scanning the code on the door tablet (it changes every minute) with the in-app scanner or the phone's own camera; location means the phone is within the restaurant's radius (default 200 m), with no scan. With QR only, the owner can also require the phone to be inside the radius. The position is read only at those two moments, and a short celebration plays when it works. |
| Payroll | Each person is paid daily, weekly, every two weeks or monthly, set per person and changeable at any time. Hourly pay from attendance at the rate in force each day, salaries spread over the days, **delivery drivers paid per trip** from the trips a manager enters each day, weekly overtime (also for daily-paid staff), bonuses, deductions, adjustments, expense repayments. Monthly allowances and deductions per person, salary advances taken back in instalments (never below zero take-home), detailed printable payslips (every line, each day paid, year to date), pay by section and against the previous payroll. Every day is paid exactly once, even after someone's frequency changes. Draft → finalized → paid; statements show 🟢 Paid, 🟡 Pending, 🔴 Requires review. Paid payrolls are locked; only the owner can reopen one to correct it, with a reason, and everyone affected is told. |
| Team chat | One chat for the whole team, and private one-to-one chats only the two people can read (the owner included). "Discuss" on a holiday or shift request opens a private chat with the manager about it. Unread counts on the Chat tab; the owner can remove team-chat messages (recorded in the activity log); people who leave lose access. |
| Employee expenses | Claims with receipt photos (compressed on the phone), manager approval, owner approval above a threshold, rejection reasons, resubmission, repayment through payroll. |
| Business finance | Expenses with categories, receipts and quantity × unit price; bills bought on credit with due dates (overdue and due soon) until marked paid; spend per supplier with a price watch on unit prices; recurring expenses (daily to yearly or every N days) recorded automatically, revenue with refunds and adjustments, budgets with 80% and 100% alerts. Edits keep history; records are archived, not deleted. |
| Insights | Owner dashboard ("How is my business doing?"), analytics with date presets (today to last year, or custom), each compared with the matching earlier period, accessible charts with table views, expense drill-down, **costs by section** (kitchen, front of house, delivery: staff pay plus that section's expenses), **sales by channel** (dine-in, takeaway, delivery), payroll and workforce analytics, and smart alerts with owner-set thresholds. |
| Restaurant setup | Choosing "Restaurant or café" at sign-up (or Settings → Restaurant setup) adds the Kitchen, Front of house and Delivery sections, food, drinks, packaging, cooking-gas, delivery-commission and food-waste expense categories, and dine-in, takeaway and delivery sales. |
| Reports | 10 reports (P&L, expenses, revenue, payroll, attendance, shifts, people…) with CSV and Excel export and print-to-PDF. Exports are built in the background and kept private. |
| Everything else | In-app notifications with email and SMS copies by preference, global search, an append-only activity log, and import from the Business Expenses app's CSV export. |

All money is calculated on the server in integer minor units (no
floating-point currency), in the business's time zone (default
Asia/Baghdad, week starting Saturday).

## Try it with demo data

You need Node.js 22.9+ and PostgreSQL 14+.

```sh
cd workforce
npm install
createdb workforce_demo
DATABASE_URL=postgres://localhost/workforce_demo npm run demo
DATABASE_URL=postgres://localhost/workforce_demo npm start
```

`npm run demo` creates a bakery in Baghdad with a manager, five employees,
eight weeks of shifts and attendance, six months of sales and expenses,
budgets, claims, a pending swap and a paid payroll, all through the real API.
Then open http://localhost:3000 and sign in with password
`demo bakery password`:

| Role | Email |
| --- | --- |
| Owner | owner@demo.test |
| Manager (runs the counter) | manager@demo.test |
| Employee | employee@demo.test |

To start empty instead, skip `npm run demo` and create a business at
http://localhost:3000. In development, email and SMS aren't sent: they're
printed in the server log (look for `DEV MESSAGE`), including verification
codes and invitation links. Migrations run automatically at start-up
(`npm run migrate` runs them alone).

## Tests

The tests run against a real PostgreSQL database, which they **wipe**. Point
them at a database used only for tests:

```sh
createdb workforce_test
TEST_DATABASE_URL=postgres://localhost/workforce_test npm test
```

97 tests cover sign-up, verification, sign-in, 2FA, sessions, CSRF and rate
limits; invitations, roles, permission overrides and attempts by employees
and managers to call owner endpoints directly; department scoping and
separation between businesses; schedule rules, swaps, requests and
attendance locks; payroll (overtime, proration, locking), expense approvals,
idempotent money requests, recurring expenses, P&L and budgets; analytics,
alerts, reports and private exports, search and both import formats; and the
append-only activity log; and for the restaurant, the clock-in zone (code,
distance, accuracy, rotation), per-trip pay, per-person pay frequency without
paying any day twice, team and private chat (privacy, moderation, leavers,
discussing a request), and costs by section. GitHub Actions runs them, with lint, on every change
to `workforce/`.

## Configuration

Settings come from environment variables, or from a `.env` file next to
`package.json` (never commit it). See [.env.example](.env.example) and
[docs/DEPLOY.md](docs/DEPLOY.md).

In production the server refuses to start without `APP_ENCRYPTION_KEY`.
Email and SMS are optional (`none` by default, free): invitations and
password resets are then links you send on WhatsApp. The development `log`
setting, which only prints messages, isn't allowed in production.

## Layout

```
server/
  app.js            Fastify app: security headers, sessions, errors, routes
  config.js         Environment settings
  jobs.js           Background work: message delivery, recurring expenses, alerts, exports
  db/               Connection pool, migration runner, SQL migrations
  auth/             Permission catalogue, sessions, CSRF, access checks
  services/         Business logic per module; every query is parameterised
  routes/           HTTP endpoints with strict JSON-schema validation
  messaging/        Email/SMS templates (ar/en) and the delivery outbox
  lib/              Passwords, tokens, encryption, TOTP, rate limits, audit, CSV/XLSX
web/                Frontend (plain ES modules, no build step)
  js/pages/         One module per screen
  js/charts.js      Dependency-free SVG charts with table views
scripts/            demo.js, backup.sh, restore.sh
test/               Mocha tests against PostgreSQL
```
