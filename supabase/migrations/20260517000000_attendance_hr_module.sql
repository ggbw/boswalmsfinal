-- ── Attendance HR Module migration ─────────────────────────────────────────
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).

-- ── 1. Add biometric_id to employees ───────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS biometric_id TEXT;

CREATE INDEX IF NOT EXISTS employees_biometric_id_idx
  ON public.employees (biometric_id) WHERE biometric_id IS NOT NULL;

-- ── 2. attendance_devices ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_devices (
  id            BIGSERIAL PRIMARY KEY,
  device_serial TEXT NOT NULL UNIQUE,
  device_name   TEXT,
  location      TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  first_seen    TIMESTAMPTZ,
  last_seen     TIMESTAMPTZ,
  last_sync     TIMESTAMPTZ
);

-- ── 3. attendance_records ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id            BIGSERIAL PRIMARY KEY,
  device_serial TEXT        NOT NULL,
  employee_id   TEXT        NOT NULL,   -- biometric / device-side id
  first_name    TEXT,
  last_name     TEXT,
  full_name     TEXT,
  department    TEXT,
  punch_at      TIMESTAMPTZ NOT NULL,
  punch_date    DATE        NOT NULL,
  punch_time    TEXT        NOT NULL,
  punch_state   TEXT,
  weekday       TEXT,
  device_name   TEXT,
  data_source   TEXT,
  imported_at   TIMESTAMPTZ DEFAULT NOW(),
  raw_row       JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_unique_punch
  ON public.attendance_records (device_serial, employee_id, punch_at);

CREATE INDEX IF NOT EXISTS attendance_records_punch_date_idx
  ON public.attendance_records (punch_date);

-- ── 4. attendance_settings (singleton, id = 1) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_settings (
  id                   BIGINT PRIMARY KEY DEFAULT 1,
  work_start_time      TIME NOT NULL DEFAULT '08:00:00',
  grace_period_minutes INT  NOT NULL DEFAULT 15,
  updated_at           TIMESTAMPTZ
);

INSERT INTO public.attendance_settings (id, work_start_time, grace_period_minutes)
  VALUES (1, '08:00:00', 15)
  ON CONFLICT (id) DO NOTHING;

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.attendance_devices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_settings ENABLE ROW LEVEL SECURITY;

-- attendance_devices
DROP POLICY IF EXISTS "Authenticated read attendance_devices"  ON public.attendance_devices;
DROP POLICY IF EXISTS "Authenticated write attendance_devices" ON public.attendance_devices;

CREATE POLICY "Authenticated read attendance_devices"
  ON public.attendance_devices FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated write attendance_devices"
  ON public.attendance_devices FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- attendance_records
DROP POLICY IF EXISTS "Authenticated read attendance_records"  ON public.attendance_records;
DROP POLICY IF EXISTS "Authenticated write attendance_records" ON public.attendance_records;

CREATE POLICY "Authenticated read attendance_records"
  ON public.attendance_records FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated write attendance_records"
  ON public.attendance_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- attendance_settings
DROP POLICY IF EXISTS "Authenticated read attendance_settings"  ON public.attendance_settings;
DROP POLICY IF EXISTS "Authenticated write attendance_settings" ON public.attendance_settings;

CREATE POLICY "Authenticated read attendance_settings"
  ON public.attendance_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated write attendance_settings"
  ON public.attendance_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
