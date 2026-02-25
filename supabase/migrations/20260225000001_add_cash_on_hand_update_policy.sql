/*
  # Add UPDATE RLS Policy for cash_on_hand

  1. Problem
    - RPC function complete_cash_sale() cannot update users.cash_on_hand
    - RLS policies on users table block UPDATE operations
    - Result: Cash deduction fails silently, sales created but cash not deducted

  2. Solution
    - Add UPDATE RLS policy allowing users to update their own cash_on_hand
    - Policy checks that auth.uid() matches the user being updated
    - RPC functions and service role can still update via admin bypass

  3. Impact
    - Cash deduction will now work atomically with sale creation
    - Sales table will show updated change_given values
    - User cash_on_hand will properly reflect withdrawals
*/

-- Add UPDATE policy: Users can update their own cash_on_hand
-- This allows the RPC function to deduct cash when processing sales
CREATE POLICY "Users can update their own cash" ON users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Add explicit policy for admins to update any user's cash_on_hand
-- This allows admin cash adjustments for manual overrides
CREATE POLICY "Admins can update user cash" ON users
  FOR UPDATE
  USING (auth.jwt() ->> 'role' = 'admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');
