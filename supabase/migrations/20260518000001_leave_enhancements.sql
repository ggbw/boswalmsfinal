-- ============================================================
-- LEAVE ENHANCEMENTS: allocations, enhanced types & requests
-- ============================================================

-- 1. Enhance leave_types with motho2-compatible columns
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS code                  TEXT;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS is_paid               BOOLEAN DEFAULT TRUE;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS requires_certificate  BOOLEAN DEFAULT FALSE;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS description           TEXT;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS max_carry_forward_days NUMERIC(6,2);
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS max_consecutive_days  NUMERIC(6,2);
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS min_days_notice       INTEGER DEFAULT 0;

-- Auto-generate code from name for existing rows
UPDATE leave_types SET code = CASE
  WHEN name ILIKE '%annual%'        THEN 'AL'
  WHEN name ILIKE '%sick%'          THEN 'SL'
  WHEN name ILIKE '%matern%'        THEN 'ML'
  WHEN name ILIKE '%patern%'        THEN 'PL'
  WHEN name ILIKE '%compassion%'    THEN 'CL'
  WHEN name ILIKE '%unpaid%'        THEN 'UL'
  WHEN name ILIKE '%study%'         THEN 'STL'
  WHEN name ILIKE '%family%'        THEN 'FL'
  WHEN name ILIKE '%bereavement%'   THEN 'BL'
  ELSE UPPER(REGEXP_REPLACE(name, '[^A-Za-z ]', '', 'g'))
END
WHERE code IS NULL;

-- Ensure uniqueness (suffix with row number if collision)
DO $$
DECLARE
  r RECORD;
  cnt INT;
BEGIN
  FOR r IN SELECT id, code FROM leave_types LOOP
    SELECT COUNT(*) INTO cnt FROM leave_types
    WHERE code = r.code AND id != r.id AND id < r.id;
    IF cnt > 0 THEN
      UPDATE leave_types SET code = r.code || cnt::text WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- 2. Enhance leave_requests with motho2-compatible columns
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS num_days           NUMERIC(6,2);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS handover_notes     TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS certificate_url    TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS certificate_filename TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS admin_notes        TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS leave_ref          TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS applied_date       DATE;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_date      DATE;

-- Sync num_days from number_of_days for existing rows
UPDATE leave_requests
SET   num_days = number_of_days
WHERE num_days IS NULL AND number_of_days IS NOT NULL;

-- Generate leave_ref for existing rows
UPDATE leave_requests
SET   leave_ref = 'LR-' || TO_CHAR(COALESCE(created_at, now()), 'YYYYMMDD') || '-' || UPPER(LEFT(id::text, 4))
WHERE leave_ref IS NULL;

-- Backfill applied_date / approved_date from existing timestamps
UPDATE leave_requests SET applied_date  = created_at::date WHERE applied_date  IS NULL;
UPDATE leave_requests SET approved_date = approved_at::date WHERE approved_date IS NULL AND approved_at IS NOT NULL;

-- 3. Create leave_allocations table
CREATE TABLE IF NOT EXISTS leave_allocations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id    UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year             INTEGER NOT NULL DEFAULT EXTRACT(year FROM now())::INTEGER,
  opening_balance  NUMERIC(6,2) NOT NULL DEFAULT 0,
  allocated_days   NUMERIC(6,2) NOT NULL DEFAULT 0,
  used_days        NUMERIC(6,2) NOT NULL DEFAULT 0,
  pending_days     NUMERIC(6,2) NOT NULL DEFAULT 0,
  remaining_days   NUMERIC(6,2) GENERATED ALWAYS AS (
    opening_balance + allocated_days - used_days - pending_days
  ) STORED,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, leave_type_id, year)
);

ALTER TABLE leave_allocations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'leave_allocations' AND policyname = 'la_all'
  ) THEN
    CREATE POLICY "la_all" ON leave_allocations
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed 2026 allocations for all active employees x active leave types
INSERT INTO leave_allocations (employee_id, leave_type_id, year, allocated_days)
SELECT e.id, lt.id, 2026, lt.max_days
FROM   employees e
CROSS  JOIN leave_types lt
WHERE  lt.is_active = true
  AND  (e.status IS NULL OR e.status = 'active')
ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;

-- Migrate employee_leave_balances → leave_allocations (set allocated_days to the
-- stored balance so remaining_days = balance immediately after migration).
-- Annual Leave
UPDATE leave_allocations la
SET    allocated_days  = GREATEST(0, elb.annual_leave),
       opening_balance = CASE WHEN elb.annual_leave < 0 THEN elb.annual_leave ELSE 0 END
FROM   employee_leave_balances elb,
       leave_types lt
WHERE  lt.id = la.leave_type_id
  AND  lt.name ILIKE '%annual%'
  AND  la.employee_id = elb.employee_id
  AND  la.year = 2026
  AND  elb.year = 2026;

-- Sick Leave
UPDATE leave_allocations la
SET    allocated_days = GREATEST(0, elb.sick_leave)
FROM   employee_leave_balances elb,
       leave_types lt
WHERE  lt.id = la.leave_type_id
  AND  lt.name ILIKE '%sick%'
  AND  la.employee_id = elb.employee_id
  AND  la.year = 2026
  AND  elb.year = 2026
  AND  elb.sick_leave > 0;

-- 4. Create public_holidays table
CREATE TABLE IF NOT EXISTS public_holidays (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  holiday_date DATE NOT NULL UNIQUE,
  year         INTEGER GENERATED ALWAYS AS (EXTRACT(year FROM holiday_date)::INTEGER) STORED
);

ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'public_holidays' AND policyname = 'ph_all'
  ) THEN
    CREATE POLICY "ph_all" ON public_holidays
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed 2026 Botswana public holidays
INSERT INTO public_holidays (name, holiday_date) VALUES
  ('New Year''s Day',            '2026-01-01'),
  ('New Year''s Day Holiday',    '2026-01-02'),
  ('Good Friday',                '2026-04-03'),
  ('Holy Saturday',              '2026-04-04'),
  ('Easter Sunday',              '2026-04-05'),
  ('Easter Monday',              '2026-04-06'),
  ('Labour Day',                 '2026-05-01'),
  ('Ascension Day',              '2026-05-14'),
  ('Sir Seretse Khama Day',      '2026-07-01'),
  ('Presidents Day',             '2026-07-20'),
  ('Presidents Day Holiday',     '2026-07-21'),
  ('Botswana Day',               '2026-09-30'),
  ('Botswana Day Holiday',       '2026-10-01'),
  ('Christmas Day',              '2026-12-25'),
  ('Boxing Day',                 '2026-12-26')
ON CONFLICT DO NOTHING;

-- 5. Trigger to keep num_days in sync when number_of_days is set
CREATE OR REPLACE FUNCTION sync_leave_num_days()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.num_days IS NULL AND NEW.number_of_days IS NOT NULL THEN
    NEW.num_days := NEW.number_of_days;
  END IF;
  IF NEW.number_of_days IS NULL AND NEW.num_days IS NOT NULL THEN
    NEW.number_of_days := NEW.num_days;
  END IF;
  IF NEW.leave_ref IS NULL THEN
    NEW.leave_ref := 'LR-' || TO_CHAR(now(), 'YYYYMMDD') || '-' || UPPER(LEFT(NEW.id::text, 4));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_leave_num_days ON leave_requests;
CREATE TRIGGER trg_sync_leave_num_days
  BEFORE INSERT OR UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION sync_leave_num_days();
