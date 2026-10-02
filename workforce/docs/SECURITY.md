# Security

How Workforce protects accounts, money and personal data, what was reviewed
in Phase 15, and what to check before going live. To report a problem,
contact the business owner running your server.

## Controls

### Accounts and sessions

- **Passwords:** argon2id; 10 to 200 characters, rejected if they contain the person's email or name or use fewer than 4 different characters. Wrong email and wrong password get the same answer and take the same time, so accounts can't be discovered.
- **No shared passwords:** people join through a one-time invitation link (7 days by default) and set their own password.
- **Verification:** 6-digit codes stored hashed, 10-minute expiry, 5 attempts, resend limits. Arabic-Indic digits are accepted.
- **Two-step verification:** authenticator apps (TOTP), with the secret encrypted at rest and 10 hashed one-time recovery codes.
- **Sessions:** random opaque tokens stored as SHA-256 hashes; `HttpOnly`, `Secure` (in production) and `SameSite=Lax` cookies; 14-day idle and 60-day absolute expiry; device list with sign-out of one device, other devices or all. A password reset or change signs out other devices.
- **CSRF:** a per-session token in the `X-CSRF-Token` header on every change.

### Rate limits (stored in PostgreSQL, so they hold across servers)

| Action | Limit |
| --- | --- |
| Sign in | 30 per IP and 10 per account, per 15 minutes |
| Two-step code | 30 per IP per 15 minutes |
| Business sign-up | 5 per IP per hour |
| Verification codes | 1 per minute and 5 per hour per account and channel |
| Password reset | 10 per IP and 3 per account per hour |
| Invitations | 200 per business per day; resend 5 per invitation per day |
| Uploads | 100 per person per hour, 10 MB each by default |
| Report exports | 60 per person per hour |

### Authorisation

- Every business endpoint checks, on the server, that the person has an **active, verified membership** of that business and the **specific permission** for the action. The interface hides what someone can't do, but nothing relies on that.
- 41 permissions, set per role and per person by the owner. Six owner-only powers (deleting the business, security settings, managing permissions, managing owners, assigning roles, permanent deletes) can't be granted to anyone.
- A manager who runs a department sees and manages only that department's people, shifts, attendance, claims and reports. A department manager's invitees join their department.
- Every query filters by business, and tests check that businesses can't see each other's data.
- Employees see only their own pay, claims, requests and published shifts. Pay details of others need `members.view_sensitive`.

### Money and records

- All amounts are integers in minor units (no floating point), calculated on the server: payroll, P&L, budgets, analytics and reports. The browser only displays them.
- Money requests carry an idempotency key, so a retried or double-tapped request is applied once.
- Paid payroll runs and the attendance inside them are locked; corrections go into the next run.
- Records are archived, not deleted. Edits keep a before-and-after history. Permanent deletion of a person is owner-only, needs the name typed, and is refused while pay, expense or attendance records exist.
- The activity log, record history and shift history are append-only: a database trigger rejects updates and deletes, even from the app's own database user.

### Files

- Uploads are stored outside the web root under random names, with permissions `0600`.
- The real type is detected from the file's contents (JPEG, PNG, WebP or PDF only), not from its name.
- Downloads go through an endpoint that checks permission and scope on every request, with `Cache-Control: private, no-store`. There are no public file URLs. Generated exports are private to the person who asked for them.

### Input, output and transport

- Every request body and query is validated by a JSON schema that rejects unknown fields. Every SQL statement is parameterised; the few dynamic SQL fragments come from fixed lists in code (reviewed in Phase 15).
- The frontend escapes all data it renders. A strict Content-Security-Policy allows scripts only from the app itself (no inline scripts), no framing, and no plugins.
- HSTS, `Referrer-Policy: no-referrer`, `X-Content-Type-Options` and `Cache-Control: no-store` on API responses.
- CSV exports neutralise spreadsheet formulas (cells starting with `=`, `+`, `-`, `@`).
- Errors returned to the browser are generic and carry a request id; details stay in the server log.

### Data at rest and messages

- 2FA secrets and personal details (national ID, date of birth, emergency contact) are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY`.
- Email and SMS go through an outbox with retries. Bodies containing codes or links are blanked once they have been sent.

## Phase 15 review

| Area | Finding | Outcome |
| --- | --- | --- |
| Dependencies | `npm audit --omit=dev`: 0 known vulnerabilities. Dependabot watches `workforce/`. | OK |
| SQL | Every `${…}` inside SQL reviewed: only fixed column or table names and generated `$n` placeholders. | OK |
| Upload size | The request limit was a fixed 15 MB regardless of `MAX_UPLOAD_MB`. | Now derived from the setting |
| Disk exhaustion | Uploads and exports had no per-person rate. | Limited (see table) |
| Department scope | An invitation's chosen department was ignored on joining, which left new people outside their manager's view. | Fixed, with a test |
| Dates | Calendar dates were parsed as local-midnight timestamps, so a server not running in UTC could shift them by a day. | Dates are now plain `YYYY-MM-DD`; tests pass under `TZ=Asia/Baghdad` |
| Container | The image runs as the unprivileged `node` user with only production dependencies. | OK |
| Headers | CSP, HSTS, frame denial and referrer policy confirmed on a production build. | OK |

Not covered by this review: a third-party penetration test. It's worth
commissioning before storing data for many businesses.

## Before going live

- [ ] Served only over HTTPS, with `APP_URL` set to the `https://` address and `TRUST_PROXY=true` behind the proxy.
- [ ] `APP_ENCRYPTION_KEY` generated freshly (32 random bytes), stored in a password manager **and** apart from database backups.
- [ ] Real SMTP and SMS credentials configured, and a test invitation received on both.
- [ ] `ALLOW_BUSINESS_SIGNUP=false` if the server is only for your business.
- [ ] The database user owns only this database and isn't a superuser.
- [ ] Backups running nightly, copied off the server, and one restore practised ([DEPLOY.md](DEPLOY.md#restoring)).
- [ ] The owner account has two-step verification turned on.
- [ ] Manager permissions reviewed under **Permissions** (for example, who sees payroll and personal details).
- [ ] Server and PostgreSQL get operating-system security updates.
- [ ] The demo script (`npm run demo`) has **not** been run against the production database.
