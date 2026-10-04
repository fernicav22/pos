/*
  # Record live users admin-view policy in migrations (no behavior change)

  Production drifted from the migrations: "Admins can view all users" on
  public.users was changed out-of-band from
    auth.jwt() ->> 'role' = 'admin'   (20260219000001, never matches: the JWT
                                       role claim is always 'authenticated')
  to
    get_current_user_role() = 'admin'
  and get_current_user_role() exists in production but in no migration.

  This migration writes down exactly what is live (definitions copied from
  pg_get_functiondef / pg_policies on 2026-10-03). Idempotent: against
  production it recreates identical objects; against a fresh database it
  brings the policy in line with production.

  - CREATE OR REPLACE keeps the function's owner and existing grants.
  - DROP + CREATE of the policy run in the migration's single transaction,
    so there is no window without the policy.
  - Managers/cashiers are unaffected: they still only match
    "Users can view their own data" (auth.uid() = id).
*/

CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS "Admins can view all users" ON public.users;

CREATE POLICY "Admins can view all users" ON public.users
  FOR SELECT
  USING (get_current_user_role() = 'admin');
