# Workforce

Workforce management, employee portal and business finance in one app, with
separate Owner, Manager and Employee access. It grows out of the Business
Expenses app in [`../expenses-app`](../expenses-app), which keeps running
unchanged until its data is imported (Phase 8).

- **Plan and architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), with the inspection of the
  existing app, database and API design, security model, and the 16-phase roadmap.
- **Status:** Phase 1 (accounts, sign-in, roles and permissions) is built and tested.

## What Phase 1 includes

| Area | What works |
| --- | --- |
| Accounts | Business registration creates the owner. The owner (or anyone given the permission) invites employees and managers. Invitees set their own password through a one-time link; nobody shares passwords. |
| Verification | Email codes or links, SMS codes, 10-minute expiry, 5 attempts per code, resend limits, verification required before entering a business |
| Sign-in | Email or phone with a password, optional authenticator-app two-step verification with 10 one-time recovery codes, generic error messages, rate limits per IP and per account |
| Sessions | HttpOnly cookies, CSRF token on every change, list of signed-in devices, sign out one device, other devices, or everywhere. A password reset or change signs out other sessions. |
| Recovery | Password reset by email link or SMS code |
| Roles | Owner, Manager, Employee. "Make manager" and "Remove manager role" with confirmation, notification and audit entry; suspend and restore access |
| Permissions | 41 granular permissions covering every module in the plan. The owner turns them on or off per role or per person. Owner-only powers can't be granted to anyone, enforced on the server. |
| Activity log | Append-only (a database trigger blocks edits and deletes), with actor, target, before and after values, IP and device |
| Interface | Arabic (default) and English with full right-to-left layout, phone bottom tabs, desktop sidebar, light and dark themes, reduced-motion support |

## Run it locally

You need Node.js 22.9+ and PostgreSQL 14+.

```sh
cd workforce
npm install
createdb workforce_dev
DATABASE_URL=postgres://localhost/workforce_dev npm start
```

Open http://localhost:3000 and create a business. In development, emails and
SMS aren't sent: they're printed in the server log (look for
`DEV MESSAGE`), including verification codes and invitation links.

Migrations run automatically at start-up (`npm run migrate` runs them alone).

## Tests

The tests run against a real PostgreSQL database, which they **wipe**. Point
them at a database used only for tests:

```sh
createdb workforce_test
TEST_DATABASE_URL=postgres://localhost/workforce_test npm test
```

They cover sign-up, verification, sign-in, rate limiting, CSRF, sessions,
password reset (email and SMS), two-step verification and recovery codes,
invitations, manager promotion and removal, suspension, permission overrides,
attempts by employees and managers to call owner endpoints directly,
separation between businesses, pagination, and the append-only activity log.
GitHub Actions runs them on every change to `workforce/`.

## Configuration

Settings come from environment variables, or from a `.env` file next to
`package.json` (never commit it). See [.env.example](.env.example).

In production the server refuses to start without `APP_ENCRYPTION_KEY` and
real email and SMS settings, so codes can't silently go nowhere.

## Layout

```
server/
  app.js            Fastify app: security headers, sessions, errors, routes
  config.js         Environment settings
  db/               Connection pool, migration runner, SQL migrations
  auth/             Permission catalogue, sessions, CSRF, access checks
  services/         Business logic (auth, team); every query is parameterised
  routes/           HTTP endpoints with strict JSON-schema validation
  messaging/        Email/SMS templates (ar/en) and the delivery outbox
  lib/              Passwords, tokens, encryption, TOTP, rate limits, audit
web/                Frontend (plain ES modules, no build step)
test/               Mocha tests against PostgreSQL
docs/ARCHITECTURE.md
```
