/*
  # Admin can view all staff

  1. Problem
    - Admins can only view their own user record due to RLS policy
    - Admins need to see all staff members in the Staff Management page

  2. Solution
    - Add new RLS policy allowing admins to view all users
    - Keep existing policy for non-admin users to view only their own data

  3. Changes
    - Add "Admins can view all users" SELECT policy
*/

-- Add policy for admins to view all users
-- Check JWT token directly to avoid recursive policy evaluation
CREATE POLICY "Admins can view all users" ON users
  FOR SELECT
  USING (auth.jwt() ->> 'role' = 'admin');
