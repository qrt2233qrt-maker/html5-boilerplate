-- Expenses upgrade: quantity × unit price (e.g. 20 kg of mozzarella at
-- 9,500 a kg), and bills not paid yet with a due date.
ALTER TABLE business_expenses
  ADD COLUMN quantity numeric(12, 3) CHECK (quantity > 0),
  ADD COLUMN unit text CHECK (length(unit) <= 20),
  ADD COLUMN unit_price bigint CHECK (unit_price > 0),
  ADD COLUMN paid boolean NOT NULL DEFAULT true,
  ADD COLUMN due_on date,
  ADD COLUMN paid_on date;
UPDATE business_expenses SET paid_on = spent_on;
CREATE INDEX business_expenses_unpaid_idx ON business_expenses (business_id, due_on) WHERE NOT paid AND archived_at IS NULL;
CREATE INDEX business_expenses_vendor_idx ON business_expenses (business_id, lower(vendor)) WHERE archived_at IS NULL;
