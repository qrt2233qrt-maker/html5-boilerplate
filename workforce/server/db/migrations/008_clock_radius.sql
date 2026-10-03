-- Clocking in by GPS: within 200 m of the restaurant by default.
ALTER TABLE locations ALTER COLUMN radius_m SET DEFAULT 200;
UPDATE locations SET radius_m = 200 WHERE radius_m = 100;
