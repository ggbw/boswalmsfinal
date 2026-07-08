-- school_config's only write policy ("Admins can manage config", 2026-03-05) is
-- admin-only. The super_admin role was added later, so a super_admin can VIEW
-- config but their UPDATEs match zero rows under RLS — Supabase returns success
-- with no error (a false "saved" toast) while nothing persists. This is why the
-- transcript signatory (issuer/title/signature) never saved for super_admins.
--
-- Grant super_admin the same management rights admins already have.

DROP POLICY IF EXISTS "Super admins can manage config" ON public.school_config;

CREATE POLICY "Super admins can manage config"
ON public.school_config
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
