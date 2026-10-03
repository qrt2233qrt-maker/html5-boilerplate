-- Restaurant features (PizzaRita): clock-in zone, per-trip driver pay,
-- per-person pay frequency, team and private chat, business type presets.

-- ---------- business type ----------
-- 'restaurant' adds kitchen / front of house / delivery sections and
-- restaurant categories; nothing else changes.
ALTER TABLE businesses ADD COLUMN kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general', 'restaurant'));

-- ---------- clock-in zone ----------
-- A location can carry its position and a radius. When the business
-- requires it, clocking in or out needs the phone inside that radius and
-- the current code shown at the door (QR on a tablet, or printed daily).
ALTER TABLE locations
  ADD COLUMN latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  ADD COLUMN longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  ADD COLUMN radius_m integer NOT NULL DEFAULT 100 CHECK (radius_m BETWEEN 20 AND 2000),
  ADD COLUMN door_secret text NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  ADD COLUMN door_mode text NOT NULL DEFAULT 'screen' CHECK (door_mode IN ('screen', 'daily')),
  ADD CONSTRAINT locations_position_pair CHECK ((latitude IS NULL) = (longitude IS NULL));

-- Where each clock-in and clock-out happened. Recorded only at those two
-- moments; staff are never tracked in between.
ALTER TABLE attendance
  ADD COLUMN location_id uuid REFERENCES locations (id),
  ADD COLUMN in_lat double precision, ADD COLUMN in_lng double precision,
  ADD COLUMN in_accuracy_m real, ADD COLUMN in_distance_m real,
  ADD COLUMN out_lat double precision, ADD COLUMN out_lng double precision,
  ADD COLUMN out_accuracy_m real, ADD COLUMN out_distance_m real;

-- ---------- pay: per-trip rates and per-person frequency ----------
ALTER TABLE pay_rates DROP CONSTRAINT pay_rates_pay_type_check;
ALTER TABLE pay_rates ADD CONSTRAINT pay_rates_pay_type_check CHECK (pay_type IN ('hourly', 'salaried', 'per_trip'));
-- How often this person is paid from effective_from on. NULL follows the
-- business default. Changing it is a new row, so every day belongs to
-- exactly one frequency and is never paid twice.
ALTER TABLE pay_rates ADD COLUMN frequency text CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly'));

ALTER TABLE payroll_runs ADD COLUMN frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly'));
ALTER TABLE payroll_runs DROP CONSTRAINT payroll_runs_business_id_period_start_key;
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_period_key UNIQUE (business_id, frequency, period_start);

ALTER TABLE payroll_items DROP CONSTRAINT payroll_items_kind_check;
ALTER TABLE payroll_items ADD CONSTRAINT payroll_items_kind_check
  CHECK (kind IN ('base', 'overtime', 'trips', 'bonus', 'deduction', 'reimbursement', 'adjustment'));
ALTER TABLE payroll_items ADD COLUMN quantity integer CHECK (quantity >= 0);
-- The exact days each statement paid, so a day is never paid twice even if
-- someone's pay frequency (or the business default) changes later.
ALTER TABLE payroll_statements ADD COLUMN days date[] NOT NULL DEFAULT '{}';
-- Statements made before this existed covered their whole period.
UPDATE payroll_statements s SET days = ARRAY(SELECT generate_series(r.period_start, r.period_end, interval '1 day')::date)
  FROM payroll_runs r WHERE r.id = s.run_id;

-- Trips a delivery driver made each day, entered by a manager.
CREATE TABLE delivery_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  day date NOT NULL,
  trips integer NOT NULL CHECK (trips BETWEEN 0 AND 500),
  note text,
  entered_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, day)
);
CREATE INDEX delivery_trips_business_day_idx ON delivery_trips (business_id, day);

-- ---------- chat ----------
-- One team thread per business, plus private threads between two people
-- (member_a < member_b so each pair has exactly one thread).
CREATE TABLE chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  kind text NOT NULL CHECK (kind IN ('team', 'direct')),
  member_a uuid REFERENCES memberships (id),
  member_b uuid REFERENCES memberships (id),
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'team' AND member_a IS NULL AND member_b IS NULL) OR (kind = 'direct' AND member_a < member_b))
);
CREATE UNIQUE INDEX chat_threads_team_key ON chat_threads (business_id) WHERE kind = 'team';
CREATE UNIQUE INDEX chat_threads_pair_key ON chat_threads (member_a, member_b) WHERE kind = 'direct';

CREATE TABLE chat_messages (
  id bigserial PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES chat_threads (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  sender_id uuid NOT NULL REFERENCES memberships (id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  -- Optional link to what the message is about (e.g. a time-off request).
  ref_type text, ref_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users (id)
);
CREATE INDEX chat_messages_thread_idx ON chat_messages (thread_id, id DESC);

CREATE TABLE chat_reads (
  thread_id uuid NOT NULL REFERENCES chat_threads (id),
  membership_id uuid NOT NULL REFERENCES memberships (id),
  last_read_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, membership_id)
);
