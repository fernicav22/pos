/*
  # Fix broken auth.jwt() ->> 'role' policies: categories modify, admin cash update

  Both policies check auth.jwt() ->> 'role', which is always 'authenticated' in this
  project (no Auth Hook embeds the app role into the JWT - see AGENTS.md). Proven broken
  by a rolled-back test: admin INSERT into categories failed with 42501, and admin UPDATE
  of another user's cash_on_hand silently affected 0 rows.

  Fix: reuse get_current_user_role() (added in 20261003000005, SECURITY DEFINER, bypasses
  RLS) - the same mechanism already proven for "Admins can view all users" and "Admins can
  update user cash" was already going to use before that fix was pulled from the Phase B
  migration for separate review.
*/

DROP POLICY IF EXISTS "Admin and managers can modify categories" ON public.categories;

CREATE POLICY "Admin and managers can modify categories" ON public.categories
  FOR ALL TO authenticated
  USING (get_current_user_role() IN ('admin', 'manager'));

DROP POLICY IF EXISTS "Admins can update user cash" ON public.users;

CREATE POLICY "Admins can update user cash" ON public.users
  FOR UPDATE
  USING (get_current_user_role() = 'admin')
  WITH CHECK (get_current_user_role() = 'admin');
