-- Payroll upgrade: regular allowances and deductions per person, salary
-- advances repaid in instalments, and corrections to a closed payroll.

-- An amount added to (allowance) or taken from (deduction) someone's pay
-- every month, e.g. transport or food allowance, or housing. Spread over
-- the days each payroll pays, like a salary, so it works for daily,
-- weekly and monthly pay alike.
CREATE TABLE pay_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  kind text NOT NULL CHECK (kind IN ('allowance', 'deduction')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  monthly_amount bigint NOT NULL CHECK (monthly_amount > 0),
  starts_on date NOT NULL,
  ends_on date CHECK (ends_on IS NULL OR ends_on >= starts_on),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX pay_components_member_idx ON pay_components (membership_id) WHERE archived_at IS NULL;

-- Money paid to someone ahead of their pay, taken back from each payroll
-- in instalments until it is repaid.
CREATE TABLE pay_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  amount bigint NOT NULL CHECK (amount > 0),
  instalment bigint NOT NULL CHECK (instalment > 0),
  given_on date NOT NULL,
  note text,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users (id)
);
CREATE INDEX pay_advances_member_idx ON pay_advances (membership_id) WHERE cancelled_at IS NULL;

ALTER TABLE payroll_items DROP CONSTRAINT payroll_items_kind_check;
ALTER TABLE payroll_items ADD CONSTRAINT payroll_items_kind_check
  CHECK (kind IN ('base', 'overtime', 'trips', 'allowance', 'bonus', 'deduction', 'advance', 'reimbursement', 'adjustment'));
ALTER TABLE payroll_items ADD COLUMN advance_id uuid REFERENCES pay_advances (id);
ALTER TABLE payroll_items ADD COLUMN component_id uuid REFERENCES pay_components (id);

-- The owner can reopen a payroll that was already paid to correct it.
-- Each reopening is kept here and in the activity log.
ALTER TABLE payroll_runs ADD COLUMN reopen_count integer NOT NULL DEFAULT 0;
CREATE TABLE payroll_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES payroll_runs (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  status_before text NOT NULL,
  net_before bigint NOT NULL,
  net_after bigint,
  reopened_by uuid REFERENCES users (id),
  reopened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX payroll_corrections_run_idx ON payroll_corrections (run_id);
