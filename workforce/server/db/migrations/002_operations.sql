-- Phases 2-10: people, scheduling, requests, attendance, payroll, expenses,
-- revenue, budgets. Money is BIGINT minor units in the business currency.

-- ---------- shared ----------

-- Every change to a financial or scheduling record keeps the previous state.
CREATE TABLE record_history (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  change_type text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  changed_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX record_history_entity_idx ON record_history (business_id, entity_type, entity_id, id);
CREATE TRIGGER record_history_no_update BEFORE UPDATE OR DELETE ON record_history
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- A retried request with the same key gets the first response instead of
-- creating a second record.
CREATE TABLE idempotency_keys (
  business_id uuid NOT NULL REFERENCES businesses (id),
  user_id uuid NOT NULL REFERENCES users (id),
  key text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id, key)
);

-- Private files (receipts, contracts, exports). Bytes live outside the web root.
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid REFERENCES memberships (id),
  kind text NOT NULL CHECK (kind IN ('receipt', 'contract', 'document', 'export')),
  filename text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL CHECK (size > 0),
  sha256 text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX documents_member_idx ON documents (business_id, membership_id) WHERE archived_at IS NULL;

-- ---------- Phase 2: people ----------

CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  manager_membership_id uuid REFERENCES memberships (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX departments_name_key ON departments (business_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

ALTER TABLE memberships
  ADD COLUMN department_id uuid REFERENCES departments (id),
  ADD COLUMN reports_to uuid REFERENCES memberships (id),
  ADD COLUMN end_date date,
  ADD COLUMN termination_reason text,
  -- Emergency contact and ID numbers, AES-256-GCM encrypted JSON.
  ADD COLUMN sensitive_enc text,
  ADD COLUMN avatar_document_id uuid REFERENCES documents (id),
  ADD COLUMN notification_prefs jsonb NOT NULL DEFAULT '{"email": true, "sms": false}'::jsonb;
CREATE INDEX memberships_department_idx ON memberships (business_id, department_id);

-- Pay is never overwritten: each change is a new row from a date.
CREATE TABLE pay_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  pay_type text NOT NULL CHECK (pay_type IN ('hourly', 'salaried')),
  -- hourly: per hour; salaried: per month
  rate bigint NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL,
  note text,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pay_rates_member_idx ON pay_rates (membership_id, effective_from DESC, created_at DESC);

-- ---------- Phase 3: schedules and shifts ----------

CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  -- NULL = open shift anyone eligible can pick up
  membership_id uuid REFERENCES memberships (id),
  department_id uuid REFERENCES departments (id),
  location_id uuid REFERENCES locations (id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  break_minutes smallint NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  notes text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (ends_at - starts_at <= interval '24 hours')
);
CREATE INDEX shifts_business_time_idx ON shifts (business_id, starts_at);
CREATE INDEX shifts_member_time_idx ON shifts (membership_id, starts_at) WHERE status = 'scheduled';

CREATE TABLE shift_history (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id),
  shift_id uuid NOT NULL REFERENCES shifts (id),
  change_type text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  approval_status text,
  request_type text,
  request_id uuid,
  changed_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shift_history_shift_idx ON shift_history (shift_id, id);
CREATE TRIGGER shift_history_no_update BEFORE UPDATE OR DELETE ON shift_history
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- Times an employee can't work.
CREATE TABLE unavailability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX unavailability_member_idx ON unavailability (membership_id, starts_at);

-- ---------- Phase 4: requests and swaps ----------

CREATE TABLE shift_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  type text NOT NULL CHECK (type IN ('change', 'time_off', 'offer')),
  shift_id uuid REFERENCES shifts (id),
  requested_starts_at timestamptz,
  requested_ends_at timestamptz,
  -- offer: the colleague who will take the shift
  taker_membership_id uuid REFERENCES memberships (id),
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
  reviewed_by uuid REFERENCES users (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shift_requests_business_idx ON shift_requests (business_id, status, created_at DESC);
CREATE INDEX shift_requests_member_idx ON shift_requests (membership_id, created_at DESC);

CREATE TABLE shift_swaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  requester_membership_id uuid NOT NULL REFERENCES memberships (id),
  requester_shift_id uuid NOT NULL REFERENCES shifts (id),
  target_membership_id uuid NOT NULL REFERENCES memberships (id),
  target_shift_id uuid NOT NULL REFERENCES shifts (id),
  reason text,
  status text NOT NULL DEFAULT 'pending_peer'
    CHECK (status IN ('pending_peer', 'pending_approval', 'approved', 'rejected', 'cancelled')),
  peer_responded_at timestamptz,
  reviewed_by uuid REFERENCES users (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_membership_id <> target_membership_id)
);
CREATE INDEX shift_swaps_business_idx ON shift_swaps (business_id, status, created_at DESC);

-- ---------- Phase 5: attendance ----------

CREATE TABLE attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  shift_id uuid REFERENCES shifts (id),
  clock_in timestamptz NOT NULL,
  clock_out timestamptz,
  break_minutes smallint NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  source text NOT NULL DEFAULT 'self' CHECK (source IN ('self', 'manager')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (clock_out IS NULL OR clock_out > clock_in)
);
CREATE INDEX attendance_member_idx ON attendance (membership_id, clock_in);
CREATE INDEX attendance_business_idx ON attendance (business_id, clock_in);
-- One open clock-in per person.
CREATE UNIQUE INDEX attendance_open_key ON attendance (membership_id) WHERE clock_out IS NULL;

-- ---------- Phases 7-9: categories ----------

CREATE TABLE expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  key text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fixed', 'operating', 'payroll', 'other')),
  icon text,
  employee_claimable boolean NOT NULL DEFAULT false,
  builtin boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  UNIQUE (business_id, key)
);

CREATE TABLE revenue_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  key text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  -- refund subtracts from revenue; adjustment carries its own sign
  kind text NOT NULL CHECK (kind IN ('sale', 'service', 'other', 'refund', 'adjustment')),
  builtin boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  UNIQUE (business_id, key)
);

-- ---------- Phase 7: employee work expenses ----------

CREATE TABLE employee_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  amount bigint NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  spent_on date NOT NULL,
  category_id uuid NOT NULL REFERENCES expense_categories (id),
  description text NOT NULL,
  business_purpose text,
  location text,
  receipt_document_id uuid REFERENCES documents (id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'reimbursed')),
  -- Which approval step is waiting (1 = manager, 2 = owner).
  approval_step smallint NOT NULL DEFAULT 1,
  needs_owner boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  decided_at timestamptz,
  reimbursed_at timestamptz,
  payroll_run_id uuid,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_expenses_business_idx ON employee_expenses (business_id, status, spent_on);
CREATE INDEX employee_expenses_member_idx ON employee_expenses (membership_id, spent_on DESC);

CREATE TABLE approvals (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  step smallint NOT NULL,
  decision text NOT NULL CHECK (decision IN ('review', 'approve', 'reject', 'reimburse')),
  note text,
  decided_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_subject_idx ON approvals (subject_type, subject_id, id);

-- ---------- Phase 8: business expenses ----------

CREATE TABLE recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  amount bigint NOT NULL CHECK (amount > 0),
  category_id uuid NOT NULL REFERENCES expense_categories (id),
  vendor text,
  description text NOT NULL,
  payment_method text,
  department_id uuid REFERENCES departments (id),
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom')),
  -- custom: every interval_days days; others: every `interval_count` units
  interval_count smallint NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 365),
  start_on date NOT NULL,
  end_on date,
  next_on date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recurring_expenses_due_idx ON recurring_expenses (next_on) WHERE active;

CREATE TABLE business_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  amount bigint NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  spent_on date NOT NULL,
  category_id uuid NOT NULL REFERENCES expense_categories (id),
  vendor text,
  description text,
  payment_method text,
  department_id uuid REFERENCES departments (id),
  document_id uuid REFERENCES documents (id),
  notes text,
  recurring_id uuid REFERENCES recurring_expenses (id),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'recurring', 'import')),
  import_ref text,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX business_expenses_date_idx ON business_expenses (business_id, spent_on) WHERE archived_at IS NULL;
CREATE INDEX business_expenses_cat_idx ON business_expenses (business_id, category_id, spent_on) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX business_expenses_recurring_key ON business_expenses (recurring_id, spent_on) WHERE recurring_id IS NOT NULL;
CREATE UNIQUE INDEX business_expenses_import_key ON business_expenses (business_id, import_ref) WHERE import_ref IS NOT NULL;

-- ---------- Phase 9: revenue ----------

CREATE TABLE revenues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  -- Positive for sales/services/other/refund (refunds are subtracted in
  -- totals); adjustments may be negative.
  amount bigint NOT NULL CHECK (amount <> 0),
  currency char(3) NOT NULL,
  received_on date NOT NULL,
  category_id uuid NOT NULL REFERENCES revenue_categories (id),
  description text,
  payment_method text,
  source text,
  notes text,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX revenues_date_idx ON revenues (business_id, received_on) WHERE archived_at IS NULL;

-- ---------- Phase 6: payroll ----------

CREATE TABLE payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  -- draft: recalculated freely; finalized: amounts fixed, awaiting payment;
  -- paid: locked forever (corrections go into a later run as adjustments)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'paid')),
  created_by uuid REFERENCES users (id),
  finalized_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (business_id, period_start)
);

CREATE TABLE payroll_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES payroll_runs (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  kind text NOT NULL CHECK (kind IN ('base', 'overtime', 'bonus', 'deduction', 'reimbursement', 'adjustment')),
  description text,
  minutes integer,
  amount bigint NOT NULL,
  -- base/overtime/reimbursement are generated; bonus/deduction/adjustment are entered
  generated boolean NOT NULL DEFAULT false,
  expense_id uuid REFERENCES employee_expenses (id),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_items_run_idx ON payroll_items (run_id, membership_id);
CREATE INDEX payroll_items_member_idx ON payroll_items (membership_id);

CREATE TABLE payroll_statements (
  run_id uuid NOT NULL REFERENCES payroll_runs (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'review')),
  review_note text,
  paid_at timestamptz,
  PRIMARY KEY (run_id, membership_id)
);

ALTER TABLE employee_expenses ADD CONSTRAINT employee_expenses_run_fk FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs (id);

-- ---------- Phase 10: budgets ----------

CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  -- category budget, or the whole payroll, or all spending
  scope text NOT NULL CHECK (scope IN ('category', 'payroll', 'total')),
  category_id uuid REFERENCES expense_categories (id),
  period text NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly', 'quarterly', 'yearly')),
  amount bigint NOT NULL CHECK (amount > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'category') = (category_id IS NOT NULL))
);
CREATE UNIQUE INDEX budgets_scope_key ON budgets (business_id, scope, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), period) WHERE active;

-- ---------- Phase 13: report jobs ----------

CREATE TABLE report_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  requested_by uuid NOT NULL REFERENCES users (id),
  report text NOT NULL,
  format text NOT NULL CHECK (format IN ('csv', 'xlsx')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  document_id uuid REFERENCES documents (id),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX report_jobs_queue_idx ON report_jobs (created_at) WHERE status = 'queued';

-- ---------- Phase 11: alerts ----------

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  dedupe_key text NOT NULL,
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  UNIQUE (business_id, dedupe_key)
);

CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
