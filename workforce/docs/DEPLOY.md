# Deploying Workforce

The app is one Node.js process plus PostgreSQL and a folder for private
uploads. It runs anywhere that offers those: a small VPS with Docker, or a
Node host with a managed PostgreSQL.

## Option A: one server with Docker Compose

```sh
cd workforce
cp .env.example .env
# Fill in .env: APP_URL, APP_ENCRYPTION_KEY, POSTGRES_PASSWORD, email and SMS.
docker compose up -d
```

This starts three containers:

| Service | What it does |
| --- | --- |
| `db` | PostgreSQL 16, data in the `db` volume |
| `app` | The app on `127.0.0.1:3000`, uploads in the `uploads` volume; runs as a non-root user with a health check |
| `backup` | Runs `scripts/backup.sh` every night at 02:30 into `./backups` |

Put a TLS proxy in front of port 3000. With [Caddy](https://caddyserver.com),
the whole configuration is:

```
work.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Set `APP_URL=https://work.example.com`. The app sends HSTS and marks cookies
`Secure` in production, so it must only be reached over HTTPS.

Updating: `git pull && docker compose up -d --build`. Migrations run at
start-up inside a lock, so a restart is all a schema change needs.

## Option B: a Node host and managed PostgreSQL

- Node.js 22.9 or newer; `npm ci --omit=dev`; start with `node server/index.js`.
- PostgreSQL 14 or newer with automated backups turned on.
- `UPLOAD_DIR` must be on persistent storage (not the app's temporary disk) and
  included in backups.
- With more than one app instance, set `RUN_JOBS=true` on exactly one and
  `false` on the others. Rate limits and sessions live in PostgreSQL, so any
  instance can serve any request.

## Configuration

Everything is in [`.env.example`](../.env.example). The ones that matter most:

| Variable | Notes |
| --- | --- |
| `APP_URL` | The public `https://` address. Used in links in emails and SMS. |
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64. Encrypts 2FA secrets and personal details. **Back it up separately from the database**: a backup without the key can't decrypt those fields, and a leaked key with a backup can. |
| `DATABASE_URL` | PostgreSQL connection string. Use a role that owns only this database. |
| `EMAIL_TRANSPORT`, `SMTP_URL`, `EMAIL_FROM` | SMTP for invitations, codes and notifications. |
| `SMS_TRANSPORT`, `TWILIO_*` | SMS codes and urgent notifications. |
| `TRUST_PROXY` | `true` behind a proxy, so rate limits see real client addresses. |
| `ALLOW_BUSINESS_SIGNUP` | Turn off once your business exists if the server is only for you. |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB` | Private file storage and the per-file limit (default 10 MB). |

The server refuses to start in production without an encryption key or with
the development `log` transports, so codes can't silently go nowhere.

## Backups

`scripts/backup.sh` writes a compressed `pg_dump` and a tarball of the
uploads, checks that the dump can be read, keeps 14 daily and 12 monthly
copies (adjust with `KEEP_DAILY` and `KEEP_MONTHLY`), and exits non-zero on
any failure.

```sh
# Outside Docker, from cron:
30 2 * * *  cd /srv/workforce && DATABASE_URL=… UPLOAD_DIR=/var/lib/workforce/uploads scripts/backup.sh >> /var/log/workforce-backup.log 2>&1
```

Then copy the backup folder off the server (another disk, object storage
with versioning, `rclone`, `restic`). A backup that lives only on the same
machine doesn't survive losing the machine. Store `APP_ENCRYPTION_KEY`
somewhere else again, such as a password manager.

If your PostgreSQL provider offers point-in-time recovery, turn it on as
well: it narrows the loss window from a day to minutes.

### Restoring

`scripts/restore.sh` restores into an **empty** database and refuses to
touch one that already has tables:

```sh
createdb workforce_restored
DATABASE_URL=postgres://…/workforce_restored UPLOAD_DIR=/var/lib/workforce/uploads-restored \
  scripts/restore.sh backups/daily/workforce-20261002-023000.dump backups/daily/uploads-20261002-023000.tar.gz
```

Check the restored copy (start the app against it and sign in), then switch
`DATABASE_URL` and `UPLOAD_DIR` over. Practise this once before you need it,
and again every few months.

## Before going live

Work through the checklist in [SECURITY.md](SECURITY.md#before-going-live).

## Importing from the Business Expenses app

1. In the Business Expenses app, choose a period covering everything (for example "This year") and press **Export CSV**.
2. In Workforce, sign in as the owner, open **Settings → Import from the Business Expenses app**, and choose the file.

Rejected expenses are skipped. Categories are matched to the new built-in
ones, and unknown ones go to "Other". Importing the same file, or an
overlapping one, again adds nothing twice. Receipt photos aren't part of
that CSV, so they stay in the old app. Salaries paid there can be brought in
through the JSON import format described in
[ARCHITECTURE.md](ARCHITECTURE.md#importing-the-current-expenses-app-phase-8).
