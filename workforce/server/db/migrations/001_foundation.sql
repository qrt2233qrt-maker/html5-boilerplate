-- Phase 1: businesses, users, memberships, permissions, invitations,
-- verification, sessions, rate limits, audit log, notifications, outbox.

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  currency char(3) NOT NULL DEFAULT 'IQD',
  currency_exponent smallint NOT NULL DEFAULT 0 CHECK (currency_exponent BETWEEN 0 AND 4),
  timezone text NOT NULL DEFAULT 'Asia/Baghdad',
  locale text NOT NULL DEFAULT 'ar',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email text,
  phone text,
  password_hash text,
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  locale text,
  totp_secret_enc text,
  totp_enabled_at timestamptz,
  recovery_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CHECK (email IS NULL OR email = lower(email)),
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$')
);
CREATE UNIQUE INDEX users_email_key ON users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_phone_key ON users (phone) WHERE phone IS NOT NULL;

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'employee')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'terminated', 'archived')),
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE INDEX memberships_business_role_idx ON memberships (business_id, role, status);

-- Owner overrides of the default permission set for a role.
CREATE TABLE role_permissions (
  business_id uuid NOT NULL REFERENCES businesses (id),
  role text NOT NULL CHECK (role IN ('manager', 'employee')),
  permission text NOT NULL,
  allowed boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, role, permission)
);

-- Per-person grants or denials, applied after role permissions.
CREATE TABLE membership_permissions (
  membership_id uuid NOT NULL REFERENCES memberships (id),
  permission text NOT NULL,
  allowed boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, permission)
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  name text NOT NULL,
  email text,
  phone text,
  role text NOT NULL CHECK (role IN ('manager', 'employee')),
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES users (id),
  revoked_at timestamptz,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX invitations_business_idx ON invitations (business_id, created_at DESC);

CREATE TABLE verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  purpose text NOT NULL
    CHECK (purpose IN ('email_verify', 'phone_verify', 'password_reset', 'login_2fa')),
  target text,
  code_hash text NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_tokens_user_idx ON verification_tokens (user_id, purpose, created_at DESC);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  user_agent text,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  business_id uuid REFERENCES businesses (id),
  actor_user_id uuid REFERENCES users (id),
  action text NOT NULL,
  target_type text,
  target_id text,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_business_idx ON audit_logs (business_id, created_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (business_id, target_type, target_id);

-- The audit log is append-only. Nothing, including the application, can
-- change or remove an entry.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses (id),
  user_id uuid NOT NULL REFERENCES users (id),
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient text NOT NULL,
  subject text,
  body text NOT NULL,
  -- Bodies with codes or links are redacted once delivered.
  sensitive boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts smallint NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX outbound_messages_queue_idx ON outbound_messages (next_attempt_at) WHERE status = 'queued';
