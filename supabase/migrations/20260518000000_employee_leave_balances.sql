-- Create employee_leave_balances table
CREATE TABLE IF NOT EXISTS public.employee_leave_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  year            integer NOT NULL DEFAULT date_part('year', now())::integer,
  sick_leave      numeric(6,2) NOT NULL DEFAULT 0,
  annual_leave    numeric(6,2) NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, year)
);

-- Seed / update leave balances for year 2026
-- Uses employee_name lookup; non-matching names are silently skipped.
DO $$
DECLARE
  data RECORD;
BEGIN
  FOR data IN
    SELECT *
    FROM (VALUES
      ('Keabetswe Thusani',        0,    8.5),
      ('Julia Keabilwe',           4,    9.0),
      ('Boisi Dibuile',            0,    4.5),
      ('Nthoyapelo Senatla',       3,    6.5),
      ('Sekgele Mono',             0,   -1.5),
      ('Neo Medupe',               0,    6.5),
      ('Poneso Kgakge',            0,   11.0),
      ('Lebogang Gaseome',         0,   11.0),
      ('Katlego Zambo',            1,    9.0),
      ('Israel Montsho',           0,    8.5),
      ('Keilwakediira Seromo',     0,    7.5),
      ('Malcom Samuel',            0,    0.0),
      ('Bonang Keabetswe',         0,    0.0),
      ('Patrick Bontshang',        4,    1.5),
      ('Obakeng Molefe',           0,   14.0),
      ('Moabi Kwati',              0,    7.5),
      ('Botlhale Ngele',           0,    0.0),
      ('Kaone Molemoeng',          0,    7.0),
      ('Claudette Latifa Ziteyo',  0,    7.5),
      ('Tumo Kelaeditse',          0,    6.0),
      ('Kewame Zwelibanzi',        0,    4.5),
      ('Troy Nathan B. Pheko',     0,    4.5),
      ('Thabang Realeboga Kabelo', 0,    4.5),
      ('Lone Peloyakgomo',         0,    4.5),
      ('Bathusi Motlhankane',      0,   -1.0),
      ('Gomolemo Mmolawa',         0,    3.0),
      ('Tsaone Dinkie Montshioa',  0,    3.0),
      ('Kutenda Mongo',            0,    1.5)
    ) AS t(emp_name, sick, annual)
  LOOP
    INSERT INTO public.employee_leave_balances (employee_id, year, sick_leave, annual_leave)
    SELECT e.id, 2026, data.sick, data.annual
    FROM public.employees e
    WHERE trim(e.employee_name) ILIKE trim(data.emp_name)
    LIMIT 1
    ON CONFLICT (employee_id, year) DO UPDATE
      SET sick_leave   = EXCLUDED.sick_leave,
          annual_leave = EXCLUDED.annual_leave,
          updated_at   = now();
  END LOOP;
END;
$$;
