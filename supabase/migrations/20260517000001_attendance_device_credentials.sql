-- ── Per-device credentials for HikVision devices ─────────────────────────────
-- Adds authentication columns to attendance_devices so each device can carry
-- its own API key and/or direct-ISAPI credentials. All columns are nullable so
-- existing auto-registered rows are unaffected.
--
-- api_key      → Hik-Connect OpenAPI bearer token OR ISAPI token header value.
--                Used by hik-attendance edge function (falls back to global
--                HIK_CONNECT_EMAIL/PASSWORD env vars when NULL).
-- device_ip    → Local IP for direct ISAPI access (hikvision-attendance fn).
-- device_port  → ISAPI port (default 80).
-- device_user  → Digest-Auth username for ISAPI (default 'admin').
-- device_password → Digest-Auth password for ISAPI.

ALTER TABLE public.attendance_devices
  ADD COLUMN IF NOT EXISTS api_key         TEXT,
  ADD COLUMN IF NOT EXISTS device_ip       TEXT,
  ADD COLUMN IF NOT EXISTS device_port     INTEGER DEFAULT 80,
  ADD COLUMN IF NOT EXISTS device_user     TEXT    DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS device_password TEXT;
