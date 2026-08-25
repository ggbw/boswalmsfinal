-- ============================================================================
-- Restrict the audit trail and backup/restore to administrators
-- ============================================================================
-- The audit and backup migrations already put a role check in front of almost
-- everything they added. One function was missed, and this closes it. Nothing
-- here creates a table, drops a policy, or changes any data.
--
--   public.close_stale_user_sessions(integer)
--
-- It was granted to `authenticated` with no role check of its own, and it is
-- not self-scoped the way start/touch/end_user_session are: it sweeps EVERY
-- open row in user_sessions, not just the caller's. So any signed-in user —
-- a student, an employee — could call it directly with p_idle_minutes => 0
-- and close every live session in the building, stamping each one
-- `end_reason = 'timeout'` and freezing its duration_seconds at whatever
-- last_seen_at happened to be.
--
-- Nothing is deleted by that and nobody is signed out (the row is a record of
-- a session, not the session itself), but it writes false endings into the one
-- table whose entire value is that it can be believed. "Who was signed in, and
-- for how long" is a question an auditor asks; a normal user should not be
-- able to change the answer.
--
-- The only caller is AuditTrailPage — src/lib/audit.ts closeStaleSessions(),
-- invoked when the Access & Duration tab opens and behind its Close stale
-- sessions button. That page is already limited to admin and super_admin, so
-- this grant was never being used by anyone else and no legitimate call is
-- lost.
--
-- WHY IT RETURNS 0 RATHER THAN RAISING
--
-- The body is wrapped in `EXCEPTION WHEN OTHERS THEN RETURN 0`, so a RAISE
-- here would be swallowed by that handler anyway and arrive at the client as
-- a plain 0. Returning early says the same thing without pretending to be an
-- error, and it matches how backup_table_order() and backup_row_counts()
-- already answer a caller who is not permitted: an empty result, not a fault.
-- The privileged callers — purge_audit_logs() and update_audit_settings() —
-- raise, because there the caller asked for a change and must be told it did
-- not happen.
--
-- Safe to run more than once.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.close_stale_user_sessions(p_idle_minutes integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_idle integer; v_count integer;
BEGIN
  -- Administrators, the service role the edge functions run as, and a direct
  -- database session. Anyone else gets 0 and changes nothing.
  --
  -- The third case is what keeps the pg_cron schedule in docs/audit-trail.md
  -- §7.1 working. pg_cron runs the statement on a plain database connection
  -- with no PostgREST request behind it, so `request.jwt.claims` is unset and
  -- both auth.uid() and auth.role() come back NULL. That is not a browser
  -- caller at all — it is a session that already holds every privilege this
  -- function could grant — so refusing it would only break the sweep that
  -- makes "signed in now" correct between visits to the report.
  --
  -- An `anon` request cannot slip through here: PostgREST sets auth.role() to
  -- 'anon' rather than NULL, and anon holds no EXECUTE on this function.
  IF NOT (
    auth.role() = 'service_role'
    OR (auth.role() IS NULL AND auth.uid() IS NULL)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  ) THEN
    RETURN 0;
  END IF;

  SELECT coalesce(p_idle_minutes, session_idle_minutes, 30)
    INTO v_idle FROM public.audit_settings WHERE id LIMIT 1;
  v_idle := coalesce(v_idle, 30);

  -- Floor the window at the configured setting's own floor. Without this an
  -- administrator could still pass 0 and close sessions that are currently
  -- active, which is the same false record the check above is there to stop —
  -- update_audit_settings() already refuses to store an idle window below 5
  -- minutes for exactly this reason.
  v_idle := GREATEST(v_idle, 5);

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

-- Unchanged from the audit migration, restated so this file is self-contained:
-- Postgres re-grants EXECUTE to PUBLIC on CREATE OR REPLACE, so the revoke has
-- to be repeated or the tightening above would be undone by the grant it
-- inherits through PUBLIC.
REVOKE ALL ON FUNCTION public.close_stale_user_sessions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_stale_user_sessions(integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ── Verify (changes nothing) ────────────────────────────────────────────────
--
--   -- as a student or employee: expect 0, and no rows closed
--   SELECT public.close_stale_user_sessions(0);
--
--   -- as an admin: expect the count of genuinely idle sessions
--   SELECT public.close_stale_user_sessions();
--
--   -- nobody but authenticated/service_role holds EXECUTE
--   SELECT proacl FROM pg_proc WHERE proname = 'close_stale_user_sessions';
