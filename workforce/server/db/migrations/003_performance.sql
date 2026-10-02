-- Indexes for lookups that grow with history (phase 15 review).
-- Each matches a query on a hot path: dashboards, "my" pages, approvals,
-- and the integrity checks that run whenever a shift changes.

-- P&L and analytics pick payroll runs by the period they close.
CREATE INDEX IF NOT EXISTS payroll_runs_period_end_idx ON payroll_runs (business_id, period_end);
-- "My pay": a person's statements across runs.
CREATE INDEX IF NOT EXISTS payroll_statements_member_idx ON payroll_statements (membership_id);
-- "My swaps", and closing open swaps when a shift is changed or cancelled.
CREATE INDEX IF NOT EXISTS shift_swaps_requester_idx ON shift_swaps (requester_membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shift_swaps_target_idx ON shift_swaps (target_membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shift_swaps_open_shift_idx ON shift_swaps (requester_shift_id, target_shift_id) WHERE status IN ('pending_peer', 'pending_approval');
CREATE INDEX IF NOT EXISTS shift_swaps_open_target_shift_idx ON shift_swaps (target_shift_id) WHERE status IN ('pending_peer', 'pending_approval');
-- Pending requests for a shift (duplicate check, closing on cancel).
CREATE INDEX IF NOT EXISTS shift_requests_open_shift_idx ON shift_requests (shift_id) WHERE status = 'pending';
-- Attendance matched to a shift (missed-shift and lateness checks).
CREATE INDEX IF NOT EXISTS attendance_shift_idx ON attendance (shift_id) WHERE shift_id IS NOT NULL;
-- Reimbursements carried by a payroll run.
CREATE INDEX IF NOT EXISTS employee_expenses_run_idx ON employee_expenses (payroll_run_id) WHERE payroll_run_id IS NOT NULL;
-- Revenue by category over time (drill-down, revenue breakdown).
CREATE INDEX IF NOT EXISTS revenues_cat_idx ON revenues (business_id, category_id, received_on) WHERE archived_at IS NULL;
