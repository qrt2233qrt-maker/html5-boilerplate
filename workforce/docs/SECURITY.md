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
| Any API request | 600 per address per minute (in memory, per server; `RATE_LIMIT_PER_MINUTE`). Page files are not counted, so an office sharing one address is not blocked by page loads. |
| Sign-in, sign-up, password and two-step routes | 60 per address per minute (in memory), plus the limits below |
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

### Clock-in zone and location privacy

- When the business requires it (on by default once a location has a position), clocking in or out needs proof of being there, as the owner chooses: the current door code, the phone inside the radius, or either (the default). The code is an HMAC of the location's secret and the minute (or the day, for a printed code), so a photo of the QR stops working a minute later. With *either*, a code passed on within that minute is accepted from anywhere; owners who need more choose *QR only* with the location check, which needs both. The phone's position is reported by the phone and can be faked on a rooted or developer-mode device; the door code is the stronger check.
- Phone positions can be faked with developer tools or spoofing apps; the rotating code is what makes that insufficient on its own. Keep the door tablet inside, and reset a location's code (Settings → Locations) if the secret might have leaked.
- The position is read only when someone clocks in or out, never in between. Staff are told so on the clock-in screen. Each record keeps the position, its accuracy and the distance from the door; only people with attendance permission see the distance.
- Positions are kept with the attendance record as evidence of where it happened. Nothing deletes them automatically yet; a scheduled clean-up after a set time can be added if you want one.

### Without email or SMS

- With `EMAIL_TRANSPORT=none` and `SMS_TRANSPORT=none` (the production default), nothing is sent and nothing costs money. The inviter gets the one-time invitation link to send themselves; opening it marks the email or phone they typed as the person's, so it must go only to that person.
- The owner's contact isn't checked by a code at sign-up (there is nothing to send it with). Turn `ALLOW_BUSINESS_SIGNUP=false` once your business exists.
- Forgot-password sends nothing and says the same thing whether or not the account exists. The owner, or a manager allowed to invite, makes a one-time reset link (24 hours, signs the person out everywhere, audited); only the owner can make one for a manager, and nobody for the owner, whose link comes from `npm run reset-link` on the server.

### Chat

- Private chats are visible only to their two members. There is no owner or admin read access, and the API returns "not found" to anyone else.
- Messages are never edited. A sender can remove their own, the owner can remove team-chat messages (audited); removed text isn't sent to anyone afterwards.
- People who are suspended or leave lose access at once; their private chats become read-only for the other person. Sending is rate-limited per person.

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
| CodeQL | "Missing rate limiting" on the sign-in routes: they were limited inside the services (PostgreSQL), which the scanner can't see. | Added an in-memory per-address ceiling on every route (tighter on sign-in) in front of the database limits, with a test |
| CodeQL | "Network data written to file" on saving uploads. | Intended: that is the upload feature. Names are random, the type is checked from the contents, the size is capped, files are `0600` and outside the web root |
| Container | The image runs as the unprivileged `node` user with only production dependencies. | OK |
| Headers | CSP, HSTS, frame denial and referrer policy confirmed on a production build. | OK |

Not covered by this review: a third-party penetration test. It's worth
commissioning before storing data for many businesses.

## Before going live

- [ ] Served only over HTTPS, with `APP_URL` set to the `https://` address and `TRUST_PROXY=true` behind the proxy.
- [ ] `APP_ENCRYPTION_KEY` generated freshly (32 random bytes), stored in a password manager **and** apart from database backups.
- [ ] Either email/SMS configured and a test invitation received, or both left at `none` and everyone who invites knows to send links only to the person's own WhatsApp.
- [ ] `ALLOW_BUSINESS_SIGNUP=false` if the server is only for your business.
- [ ] The database user owns only this database and isn't a superuser.
- [ ] Backups running nightly, copied off the server, and one restore practised ([DEPLOY.md](DEPLOY.md#restoring)).
- [ ] The owner account has two-step verification turned on.
- [ ] Manager permissions reviewed under **Permissions** (for example, who sees payroll and personal details).
- [ ] Server and PostgreSQL get operating-system security updates.
- [ ] The demo script (`npm run demo`) has **not** been run against the production database.
- [ ] Each location's position set from inside the building, the door tablet mounted indoors on the door screen, and staff told that location is checked only when clocking in and out.
