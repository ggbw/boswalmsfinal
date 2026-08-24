-- ============================================================================
-- Audit Trail — who did what, from where, as which role, and for how long
-- ============================================================================
-- Adds four things and changes nothing that already exists:
--
--   public.audit_logs      one row per recorded event (auth, data change,
--                          access, export, admin action)
--   public.user_sessions   one row per sign-in: start, last seen, end, and
--                          the DURATION OF ACCESS derived from them
--   public.audit_settings  a single-row switchboard so the whole feature can
--                          be turned down or off without a deploy
--   triggers               a generic AFTER-ROW trigger on the tables that
--                          matter, capturing before/after values
--
-- DESIGN RULES, and why
--
--   1. Auditing must never break a business write. Every function body ends
--      in `EXCEPTION WHEN OTHERS THEN` and returns quietly. A full disk or a
--      dropped column in the audit table must not stop someone recording a
--      mark. This is the single most important property here.
--
--   2. Identity is denormalised at write time. `actor_username`, `actor_name`
--      and `actor_role` are copied into the row rather than joined later,
--      because the whole point of an audit trail is that it still reads
--      correctly after the account is deleted or the role is changed. A join
--      would silently rewrite history.
--
--   3. The IP address comes from the request headers PostgREST exposes to
--      SQL, not from the browser. A browser cannot see its own public IP, and
--      anything it claims about one is unverifiable.
--
--   4. Append-only. `authenticated` is granted SELECT and nothing else;
--      inserts happen through SECURITY DEFINER functions. A guard trigger
--      also refuses UPDATE and DELETE unless the sanctioned purge function is
--      running, so a compromised admin session cannot quietly edit the record
--      of what it did.
--
-- Idempotent — safe to run more than once, and safe to run against a database
-- where some of the listed tables do not exist (schema drift is normal here).
-- Apply it in the Supabase SQL editor; do NOT `supabase db push` (see
-- supabase/config.toml for why).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Settings
-- ─────────────────────────────────────────────────────────────────────────────
-- One row, enforced by a boolean primary key with a CHECK — a pattern that
-- makes a second row impossible rather than merely discouraged.

CREATE TABLE IF NOT EXISTS public.audit_settings (
  id                   boolean     PRIMARY KEY DEFAULT true CHECK (id),
  enabled              boolean     NOT NULL DEFAULT true,
  log_data_changes     boolean     NOT NULL DEFAULT true,
  -- Off by default: a view event per navigation is a lot of rows for little
  -- signal. Turn it on for an investigation, then turn it back off.
  log_page_views       boolean     NOT NULL DEFAULT false,
  log_exports          boolean     NOT NULL DEFAULT true,
  -- When false, changed_fields is still recorded but the before/after JSON is
  -- not. Halves the storage and keeps personal data out of the audit table.
  store_payloads       boolean     NOT NULL DEFAULT true,
  retain_days          integer     NOT NULL DEFAULT 365 CHECK (retain_days >= 30),
  session_idle_minutes integer     NOT NULL DEFAULT 30  CHECK (session_idle_minutes >= 5),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid
);

INSERT INTO public.audit_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The event log
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at    timestamptz NOT NULL DEFAULT now(),

  -- WHO. Kept as loose text on purpose: no foreign key to auth.users, because
  -- deleting a user must not delete the evidence of what they did.
  actor_id       uuid,
  actor_username text,
  actor_name     text,
  actor_role     text,
  session_id     uuid,

  -- WHAT
  action         text        NOT NULL,
  category       text        NOT NULL DEFAULT 'data',
  entity_type    text,
  entity_id      text,
  entity_label   text,
  summary        text,

  -- BEFORE / AFTER
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],

  -- WHERE FROM
  ip_address     inet,
  user_agent     text,

  severity       text        NOT NULL DEFAULT 'info',
  status         text        NOT NULL DEFAULT 'success',
  metadata       jsonb
);

-- The page reads newest-first and filters on these four columns, so index all
-- four. occurred_at DESC because a plain index would be scanned backwards.
CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_idx ON public.audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx       ON public.audit_logs (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx      ON public.audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx      ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_category_idx    ON public.audit_logs (category, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_session_idx     ON public.audit_logs (session_id);
CREATE INDEX IF NOT EXISTS audit_logs_ip_idx          ON public.audit_logs (ip_address);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Sessions — the "duration of access" half of the requirement
-- ─────────────────────────────────────────────────────────────────────────────
-- started_at → ended_at is the honest duration when someone signs out. Most
-- people close the tab instead, so last_seen_at is heart-beaten by the client
-- and close_stale_user_sessions() settles the row afterwards. Without that,
-- every abandoned session would read as "still open" for ever and the report
-- would be worthless.

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL,
  username         text,
  full_name        text,
  role             text,

  started_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  end_reason       text,
  duration_seconds integer,

  ip_address       inet,
  user_agent       text,

  is_impersonation boolean     NOT NULL DEFAULT false,
  impersonator_id  uuid
);

CREATE INDEX IF NOT EXISTS user_sessions_user_idx    ON public.user_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS user_sessions_started_idx ON public.user_sessions (started_at DESC);
-- Partial: the idle sweep and the "signed in now" count both scan exactly this
-- set, which stays small however large the history grows.
CREATE INDEX IF NOT EXISTS user_sessions_open_idx    ON public.user_sessions (last_seen_at) WHERE ended_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Request context helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- PostgREST publishes the incoming HTTP headers as a GUC. It is absent when
-- SQL runs from the editor or a cron job, hence the `true` (missing_ok) and
-- the exception guard: reading it must never be the thing that fails.
CREATE OR REPLACE FUNCTION public.audit_request_header(_name text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v text;
BEGIN
  BEGIN
    v := current_setting('request.headers', true)::json ->> _name;
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;
  RETURN nullif(btrim(coalesce(v, '')), '');
END;
$$;

-- x-forwarded-for arrives as "client, proxy1, proxy2" — the client is first.
-- The cast is guarded because a malformed header must yield NULL, not an
-- error that aborts the caller's transaction.
CREATE OR REPLACE FUNCTION public.audit_client_ip()
RETURNS inet
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE raw text; first text;
BEGIN
  raw := coalesce(
    public.audit_request_header('x-forwarded-for'),
    public.audit_request_header('cf-connecting-ip'),
    public.audit_request_header('x-real-ip')
  );
  IF raw IS NULL THEN RETURN NULL; END IF;
  first := btrim(split_part(raw, ',', 1));
  BEGIN
    RETURN first::inet;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$;

-- Identity as it stands right now, resolved once per event. Returns a row even
-- for an unknown user so callers never have to null-check three fields.
CREATE OR REPLACE FUNCTION public.audit_actor(_user_id uuid)
RETURNS TABLE (username text, full_name text, role_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT coalesce(p.username, p.email)::text,
           p.name::text,
           (SELECT ur.role::text FROM public.user_roles ur
             WHERE ur.user_id = _user_id ORDER BY ur.role LIMIT 1)
      FROM public.profiles p
     WHERE p.user_id = _user_id
     LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::text,
      (SELECT ur.role::text FROM public.user_roles ur
        WHERE ur.user_id = _user_id ORDER BY ur.role LIMIT 1);
  END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Writing an event
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action      text,
  p_category    text    DEFAULT 'data',
  p_entity_type text    DEFAULT NULL,
  p_entity_id   text    DEFAULT NULL,
  p_entity_label text   DEFAULT NULL,
  p_summary     text    DEFAULT NULL,
  p_metadata    jsonb   DEFAULT NULL,
  p_severity    text    DEFAULT 'info',
  p_status      text    DEFAULT 'success',
  p_session_id  uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_actor record;
  v_id    uuid;
  v_on    boolean;
BEGIN
  SELECT enabled INTO v_on FROM public.audit_settings WHERE id LIMIT 1;
  IF v_on IS DISTINCT FROM true THEN RETURN NULL; END IF;

  -- An unauthenticated caller can only reach here through log_auth_event,
  -- which supplies its own identity in the metadata.
  IF v_uid IS NULL THEN
    INSERT INTO public.audit_logs (
      action, category, entity_type, entity_id, entity_label, summary,
      metadata, severity, status, ip_address, user_agent, session_id)
    VALUES (
      p_action, p_category, p_entity_type, p_entity_id, p_entity_label, p_summary,
      p_metadata, p_severity, p_status,
      public.audit_client_ip(), public.audit_request_header('user-agent'), p_session_id)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO v_actor FROM public.audit_actor(v_uid);

  INSERT INTO public.audit_logs (
    actor_id, actor_username, actor_name, actor_role, session_id,
    action, category, entity_type, entity_id, entity_label, summary,
    metadata, severity, status, ip_address, user_agent)
  VALUES (
    v_uid, v_actor.username, v_actor.full_name, v_actor.role_name, p_session_id,
    p_action, p_category, p_entity_type, p_entity_id, p_entity_label, p_summary,
    p_metadata, p_severity, p_status,
    public.audit_client_ip(), public.audit_request_header('user-agent'))
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  -- Rule 1: never break the caller.
  RETURN NULL;
END;
$$;

-- Sign-in failures happen before there is a session, so this one is reachable
-- by `anon`. The action is whitelisted and the payload is limited to a
-- username and a reason, so the widest thing an unauthenticated caller can do
-- is add noise to one category — which the page can filter out.
CREATE OR REPLACE FUNCTION public.log_auth_event(
  p_action   text,
  p_username text DEFAULT NULL,
  p_status   text DEFAULT 'failure',
  p_detail   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_on boolean;
BEGIN
  IF p_action NOT IN ('login_failed', 'login_blocked', 'password_reset_requested') THEN
    RETURN NULL;
  END IF;

  SELECT enabled INTO v_on FROM public.audit_settings WHERE id LIMIT 1;
  IF v_on IS DISTINCT FROM true THEN RETURN NULL; END IF;

  INSERT INTO public.audit_logs (
    actor_username, action, category, summary, severity, status,
    ip_address, user_agent, metadata)
  VALUES (
    left(coalesce(p_username, ''), 200), p_action, 'auth',
    left(coalesce(p_detail, ''), 500),
    CASE WHEN p_action = 'login_failed' THEN 'warning' ELSE 'info' END,
    p_status,
    public.audit_client_ip(), public.audit_request_header('user-agent'),
    jsonb_build_object('attempted_username', left(coalesce(p_username, ''), 200)))
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Session lifecycle
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.start_user_session(p_user_agent text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_actor     record;
  v_id        uuid;
  v_on        boolean;
  v_imp_admin uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT enabled INTO v_on FROM public.audit_settings WHERE id LIMIT 1;
  IF v_on IS DISTINCT FROM true THEN RETURN NULL; END IF;

  SELECT * INTO v_actor FROM public.audit_actor(v_uid);

  -- Flag the session as an impersonation if an admin opened one for this
  -- account and it is still live. Guarded because the table predates this
  -- migration in some deployments.
  IF to_regclass('public.impersonation_sessions') IS NOT NULL THEN
    BEGIN
      SELECT i.admin_user_id INTO v_imp_admin
        FROM public.impersonation_sessions i
       WHERE i.target_user_id = v_uid AND i.ended_at IS NULL AND i.expires_at > now()
       ORDER BY i.started_at DESC LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_imp_admin := NULL;
    END;
  END IF;

  INSERT INTO public.user_sessions (
    user_id, username, full_name, role, ip_address, user_agent,
    is_impersonation, impersonator_id)
  VALUES (
    v_uid, v_actor.username, v_actor.full_name, v_actor.role_name,
    public.audit_client_ip(),
    coalesce(p_user_agent, public.audit_request_header('user-agent')),
    v_imp_admin IS NOT NULL, v_imp_admin)
  RETURNING id INTO v_id;

  PERFORM public.log_audit_event(
    CASE WHEN v_imp_admin IS NOT NULL THEN 'login_impersonated' ELSE 'login' END,
    'auth', 'session', v_id::text, v_actor.full_name,
    'Signed in', NULL, 'info', 'success', v_id);

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Heartbeat. Deliberately cheap — one indexed UPDATE, no audit row. Scoped to
-- the caller's own session so one user cannot keep another's alive.
CREATE OR REPLACE FUNCTION public.touch_user_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_session_id IS NULL OR auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.user_sessions
     SET last_seen_at = now()
   WHERE id = p_session_id AND user_id = auth.uid() AND ended_at IS NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_user_session(
  p_session_id uuid,
  p_reason     text DEFAULT 'signout'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.user_sessions%rowtype;
BEGIN
  IF p_session_id IS NULL THEN RETURN; END IF;

  UPDATE public.user_sessions
     SET ended_at         = now(),
         last_seen_at     = now(),
         end_reason       = p_reason,
         duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::integer)
   WHERE id = p_session_id
     AND ended_at IS NULL
     AND (auth.uid() IS NULL OR user_id = auth.uid())
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RETURN; END IF;

  PERFORM public.log_audit_event(
    'logout', 'auth', 'session', v_row.id::text, v_row.full_name,
    'Signed out after ' || v_row.duration_seconds || 's',
    jsonb_build_object('duration_seconds', v_row.duration_seconds, 'reason', p_reason),
    'info', 'success', v_row.id);
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

-- Settles sessions nobody signed out of. Duration is measured to last_seen_at,
-- not to now() — crediting someone with eight hours of access because they
-- left a tab open overnight would be a false record, and this table exists to
-- be believed.
CREATE OR REPLACE FUNCTION public.close_stale_user_sessions(p_idle_minutes integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_idle integer; v_count integer;
BEGIN
  SELECT coalesce(p_idle_minutes, session_idle_minutes, 30)
    INTO v_idle FROM public.audit_settings WHERE id LIMIT 1;
  v_idle := coalesce(v_idle, 30);

  WITH closed AS (
    UPDATE public.user_sessions
       SET ended_at         = last_seen_at,
           end_reason       = 'timeout',
           duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (last_seen_at - started_at))::integer)
     WHERE ended_at IS NULL
       AND last_seen_at < now() - make_interval(mins => v_idle)
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM closed;

  RETURN coalesce(v_count, 0);
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Generic row-change trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- AFTER ROW, so the return value is ignored and this cannot alter or veto the
-- write it is recording. Fully generic via to_jsonb(), so it needs no
-- knowledge of any table's columns and cannot drift out of step with them.

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s          public.audit_settings%rowtype;
  v_old      jsonb;
  v_new      jsonb;
  v_changed  text[];
  v_key      text;
  v_id       text;
  v_label    text;
  v_uid      uuid := auth.uid();
  v_actor    record;
  v_action   text;
BEGIN
  SELECT * INTO s FROM public.audit_settings WHERE id LIMIT 1;
  IF s.enabled IS DISTINCT FROM true OR s.log_data_changes IS DISTINCT FROM true THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW); v_action := 'insert';
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD); v_action := 'delete';
  ELSE
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_action := 'update';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_changed := ARRAY[]::text[];
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    -- A no-op UPDATE (same values written again) is not a change and must not
    -- look like one. Recording it would bury the real edits.
    IF array_length(v_changed, 1) IS NULL THEN RETURN NULL; END IF;
  END IF;

  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');

  -- Best available human label, so the log reads "Mono Sekgele" rather than a
  -- bare UUID. Falls through the names these tables actually use.
  v_label := coalesce(
    v_new ->> 'name',  v_old ->> 'name',
    v_new ->> 'title', v_old ->> 'title',
    v_new ->> 'full_name', v_old ->> 'full_name',
    v_new ->> 'code',  v_old ->> 'code',
    v_new ->> 'email', v_old ->> 'email');

  SELECT * INTO v_actor FROM public.audit_actor(v_uid);

  INSERT INTO public.audit_logs (
    actor_id, actor_username, actor_name, actor_role,
    action, category, entity_type, entity_id, entity_label,
    old_data, new_data, changed_fields,
    ip_address, user_agent, severity,
    summary)
  VALUES (
    v_uid, v_actor.username, v_actor.full_name, v_actor.role_name,
    v_action, 'data', TG_TABLE_NAME, v_id, left(v_label, 200),
    CASE WHEN s.store_payloads THEN v_old END,
    CASE WHEN s.store_payloads THEN v_new END,
    v_changed,
    public.audit_client_ip(), public.audit_request_header('user-agent'),
    -- Changes to who-can-do-what are the ones a reviewer must never miss.
    CASE WHEN TG_TABLE_NAME IN ('user_roles', 'profiles') THEN 'warning' ELSE 'info' END,
    initcap(v_action) || ' on ' || TG_TABLE_NAME);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Rule 1, again and most importantly: a failure to audit must not become a
  -- failure to save.
  RETURN NULL;
END;
$$;

-- Attach/detach helpers. Both skip tables that are not present, because this
-- database has drifted from its migrations before and a missing table must not
-- abort the run.
CREATE OR REPLACE FUNCTION public.enable_row_audit(_table text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.' || quote_ident(_table)) IS NULL THEN
    RAISE NOTICE 'audit: skipped % — table not present', _table;
    RETURN;
  END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS zz_audit_%s ON public.%I', _table, _table);
  EXECUTE format(
    'CREATE TRIGGER zz_audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I '
    'FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', _table, _table);
END;
$$;

CREATE OR REPLACE FUNCTION public.disable_row_audit(_table text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.' || quote_ident(_table)) IS NULL THEN RETURN; END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS zz_audit_%s ON public.%I', _table, _table);
END;
$$;

-- The audited tables.
--
-- Deliberately EXCLUDED, and why: attendance_records and hr_attendance (raw
-- biometric punches — machine-generated, thousands per month, and already
-- immutable), sync_runs (device polling), notifications / user_notifications /
-- hr_notifications (system chatter). Auditing those would bury the human
-- actions this table exists to show.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- identity and access
    'profiles', 'user_roles', 'impersonation_sessions',
    -- academic records
    'students', 'student_modules', 'student_registrations',
    'student_registration_modules', 'marks', 'assessment_marks',
    'module_outcomes', 'exams', 'assignments', 'submissions', 'attendance',
    -- academic structure
    'classes', 'modules', 'module_classes', 'module_notes', 'programmes',
    'programme_modules', 'lecturer_modules', 'timetable', 'timetable_documents',
    'departments', 'rooms', 'terms', 'public_holidays',
    -- admissions
    'applicants', 'applications', 'admission_enquiries',
    -- configuration
    'school_config', 'company_settings', 'attendance_settings',
    'attendance_devices', 'document_settings', 'document_types',
    -- HR: people, pay and contracts
    'employees', 'hr_departments', 'employee_groups', 'employee_group_members',
    'employee_documents', 'employee_pay_components', 'pay_component_defs',
    'payslips', 'contracts', 'contract_lines', 'contract_templates',
    'contract_template_lines',
    -- HR: leave and money
    'leave_requests', 'leave_types', 'leave_allocations',
    'employee_leave_balances', 'advance_salaries', 'loan_types',
    -- HR: workflow
    'workflows', 'workflow_stages', 'workflow_stage_owners',
    'workflow_assignments', 'workflow_instances', 'workflow_stage_approvals'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    PERFORM public.enable_row_audit(t);
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Tamper guard and retention
-- ─────────────────────────────────────────────────────────────────────────────
-- An audit trail that can be edited by the people it audits is decoration.
-- UPDATE and DELETE are refused unless purge_audit_logs() is the caller, which
-- announces itself with a transaction-local setting.
--
-- If you ever need to bypass this from the SQL editor (a genuine schema
-- repair, say):  ALTER TABLE public.audit_logs DISABLE TRIGGER zz_audit_immutable;

CREATE OR REPLACE FUNCTION public.audit_logs_immutable()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.audit_purge', true), '') = 'on' THEN
    -- NEW on an UPDATE, OLD on a DELETE. Returning OLD from a BEFORE UPDATE
    -- would silently discard the update rather than allow it.
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only — use purge_audit_logs() to apply retention';
END;
$$;

DROP TRIGGER IF EXISTS zz_audit_immutable ON public.audit_logs;
CREATE TRIGGER zz_audit_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_immutable();

CREATE OR REPLACE FUNCTION public.purge_audit_logs(p_days integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_days integer; v_count integer;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only administrators may purge the audit trail';
  END IF;

  SELECT coalesce(p_days, retain_days, 365) INTO v_days
    FROM public.audit_settings WHERE id LIMIT 1;
  v_days := GREATEST(coalesce(v_days, 365), 30);

  PERFORM set_config('app.audit_purge', 'on', true);

  WITH gone AS (
    DELETE FROM public.audit_logs
     WHERE occurred_at < now() - make_interval(days => v_days)
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM gone;

  DELETE FROM public.user_sessions
   WHERE started_at < now() - make_interval(days => v_days);

  PERFORM set_config('app.audit_purge', 'off', true);

  PERFORM public.log_audit_event(
    'purge', 'admin', 'audit_logs', NULL, NULL,
    'Purged ' || coalesce(v_count, 0) || ' entries older than ' || v_days || ' days',
    jsonb_build_object('days', v_days, 'deleted', coalesce(v_count, 0)),
    'warning', 'success', NULL);

  RETURN coalesce(v_count, 0);
END;
$$;

-- Settings are themselves security-relevant: turning the audit off is exactly
-- what someone would do first. Only admins may write, and the change is logged.
CREATE OR REPLACE FUNCTION public.update_audit_settings(
  p_enabled          boolean DEFAULT NULL,
  p_log_data_changes boolean DEFAULT NULL,
  p_log_page_views   boolean DEFAULT NULL,
  p_log_exports      boolean DEFAULT NULL,
  p_store_payloads   boolean DEFAULT NULL,
  p_retain_days      integer DEFAULT NULL,
  p_idle_minutes     integer DEFAULT NULL
)
RETURNS public.audit_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.audit_settings%rowtype;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only administrators may change audit settings';
  END IF;

  UPDATE public.audit_settings
     SET enabled              = coalesce(p_enabled, enabled),
         log_data_changes     = coalesce(p_log_data_changes, log_data_changes),
         log_page_views       = coalesce(p_log_page_views, log_page_views),
         log_exports          = coalesce(p_log_exports, log_exports),
         store_payloads       = coalesce(p_store_payloads, store_payloads),
         retain_days          = GREATEST(coalesce(p_retain_days, retain_days), 30),
         session_idle_minutes = GREATEST(coalesce(p_idle_minutes, session_idle_minutes), 5),
         updated_at           = now(),
         updated_by           = auth.uid()
   WHERE id
  RETURNING * INTO v_row;

  -- Logged with enabled = true forced on for the duration of the insert, so
  -- "the audit was switched off" is itself always in the trail.
  INSERT INTO public.audit_logs (
    actor_id, action, category, entity_type, summary, new_data, severity)
  VALUES (
    auth.uid(), 'settings_change', 'admin', 'audit_settings',
    'Audit settings updated', to_jsonb(v_row), 'warning');

  RETURN v_row;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Row-level security and grants
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.audit_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_settings ENABLE ROW LEVEL SECURITY;

-- audit_logs — administrators see everything; everyone else sees only their own
-- footprint. That second policy is what makes "My Activity" possible without a
-- second table, and it is a reasonable thing for a person to be able to check.
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Users read own audit entries" ON public.audit_logs;
CREATE POLICY "Users read own audit entries"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (actor_id = auth.uid());

DROP POLICY IF EXISTS "Admins read sessions" ON public.user_sessions;
CREATE POLICY "Admins read sessions"
  ON public.user_sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Users read own sessions" ON public.user_sessions;
CREATE POLICY "Users read own sessions"
  ON public.user_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- The client reads log_page_views to decide whether to report navigation, so
-- SELECT is open to any signed-in user. Writing goes through
-- update_audit_settings(), which checks the role itself.
DROP POLICY IF EXISTS "Anyone signed in reads audit settings" ON public.audit_settings;
CREATE POLICY "Anyone signed in reads audit settings"
  ON public.audit_settings FOR SELECT TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policy exists on any of the three tables by design.
-- Every write in this file happens inside a SECURITY DEFINER function, which
-- is the only sanctioned path.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_sessions  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_settings FROM anon, authenticated;

GRANT SELECT ON public.audit_logs     TO authenticated;
GRANT SELECT ON public.user_sessions  TO authenticated;
GRANT SELECT ON public.audit_settings TO authenticated;

-- Postgres grants EXECUTE to PUBLIC on every new function, so revoking from
-- `anon` and `authenticated` alone would change nothing — they would still
-- hold it through PUBLIC. Revoke from PUBLIC first, then grant back only what
-- the client legitimately calls. The internal helpers (audit_actor in
-- particular, which resolves a username from any uuid) get nothing: they run
-- as the definer inside the functions below and are not for direct use.
REVOKE ALL ON FUNCTION public.audit_row_change()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_logs_immutable()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enable_row_audit(text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disable_row_audit(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_actor(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_client_ip()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_request_header(text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.log_audit_event(text, text, text, text, text, text, jsonb, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_auth_event(text, text, text, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_user_session(text)                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_user_session(uuid)                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.end_user_session(uuid, text)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_stale_user_sessions(integer)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_audit_logs(integer)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_audit_settings(boolean, boolean, boolean, boolean, boolean, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, text, text, text, jsonb, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_auth_event(text, text, text, text)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_user_session(text)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_user_session(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_user_session(uuid, text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_stale_user_sessions(integer)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_audit_logs(integer)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_audit_settings(boolean, boolean, boolean, boolean, boolean, integer, integer) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. What was installed
-- ─────────────────────────────────────────────────────────────────────────────
SELECT c.relname AS audited_table
  FROM pg_trigger t
  JOIN pg_class  c ON c.oid = t.tgrelid
  JOIN pg_proc   p ON p.oid = t.tgfoid
 WHERE p.proname = 'audit_row_change'
   AND NOT t.tgisinternal
 ORDER BY 1;
