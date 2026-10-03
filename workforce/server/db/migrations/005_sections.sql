-- Restaurant sections (departments) in analytics: each payroll statement and
-- each employee expense remembers the section the person worked in at the
-- time, so moving someone later doesn't rewrite last month's section costs.
ALTER TABLE payroll_statements ADD COLUMN department_id uuid REFERENCES departments (id);
ALTER TABLE employee_expenses ADD COLUMN department_id uuid REFERENCES departments (id);
UPDATE payroll_statements s SET department_id = m.department_id FROM memberships m WHERE m.id = s.membership_id;
UPDATE employee_expenses e SET department_id = m.department_id FROM memberships m WHERE m.id = e.membership_id;

CREATE FUNCTION fill_member_department() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.department_id IS NULL THEN
    SELECT department_id INTO NEW.department_id FROM memberships WHERE id = NEW.membership_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_statements_department BEFORE INSERT ON payroll_statements FOR EACH ROW EXECUTE FUNCTION fill_member_department();
CREATE TRIGGER employee_expenses_department BEFORE INSERT ON employee_expenses FOR EACH ROW EXECUTE FUNCTION fill_member_department();

CREATE INDEX business_expenses_department_idx ON business_expenses (business_id, department_id, spent_on) WHERE archived_at IS NULL;
