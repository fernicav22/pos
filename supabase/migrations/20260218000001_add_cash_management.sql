/*
  # Add Cash Management Features & Atomic Sale RPC

  1. Problem
    - Need to track cash balance per user (cashier)
    - Need to store cash amounts in transactions (cash_tendered, change_given)
    - Need audit log for admin adjustments to cash on hand
    - Need atomic transaction for cash deduction with sale insertion

  2. Solution
    - Add cash_on_hand column to users table
    - Create cash_adjustments table for audit trail
    - Add cash transaction fields to sales table
    - Create complete_cash_sale() RPC function for atomic cash transactions

  3. Changes
    - users.cash_on_hand: DECIMAL(10,2) DEFAULT 0 (amount of physical cash drawer)
    - sales.cash_tendered: DECIMAL(10,2) (amount customer handed over)
    - sales.change_given: DECIMAL(10,2) (amount of change returned)
    - cash_adjustments table: audit log of admin adjustments
    - complete_cash_sale() RPC function: atomic sale + items + cash deduction
*/

-- Step 1: Add cash_on_hand to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS cash_on_hand DECIMAL(10, 2) DEFAULT 0 NOT NULL;

-- Step 2: Create cash_adjustments audit log table
CREATE TABLE IF NOT EXISTS cash_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  old_amount DECIMAL(10, 2) NOT NULL,
  new_amount DECIMAL(10, 2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Step 3: Add indexes to cash_adjustments for efficient querying
CREATE INDEX IF NOT EXISTS idx_cash_adjustments_user_id ON cash_adjustments(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_adjustments_admin_id ON cash_adjustments(admin_id);
CREATE INDEX IF NOT EXISTS idx_cash_adjustments_created_at ON cash_adjustments(created_at);

-- Step 4: Add cash transaction fields to sales table
ALTER TABLE sales
ADD COLUMN IF NOT EXISTS cash_tendered DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS change_given DECIMAL(10, 2);

-- Step 5: Set RLS policies on cash_adjustments table
ALTER TABLE cash_adjustments ENABLE ROW LEVEL SECURITY;

-- Only admins can read all cash adjustments
CREATE POLICY "admin_read_all_cash_adjustments" ON cash_adjustments
  FOR SELECT
  USING (auth.jwt() ->> 'role' = 'admin');

-- Only admins can insert cash adjustments
CREATE POLICY "admin_insert_cash_adjustments" ON cash_adjustments
  FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');

-- Non-admins cannot modify cash_adjustments table directly
-- (enforced at application level - they only see their own adjustments if needed)

-- Step 6: Create complete_cash_sale() RPC function for atomic transactions
-- This function combines sale insertion, sale items insertion, and cash deduction
-- into a single atomic transaction - if any step fails, entire transaction rolls back
CREATE OR REPLACE FUNCTION complete_cash_sale(
  p_user_id UUID,
  p_customer_id UUID,
  p_subtotal DECIMAL,
  p_tax DECIMAL,
  p_shipping DECIMAL,
  p_total DECIMAL,
  p_payment_method TEXT,
  p_cash_tendered DECIMAL,
  p_change_given DECIMAL,
  p_sale_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_id UUID;
BEGIN
  -- Insert sale record
  INSERT INTO sales (
    user_id,
    customer_id,
    subtotal,
    tax,
    shipping,
    total,
    payment_method,
    payment_status,
    cash_tendered,
    change_given
  )
  VALUES (
    p_user_id,
    p_customer_id,
    p_subtotal,
    p_tax,
    p_shipping,
    p_total,
    p_payment_method,
    'completed',
    p_cash_tendered,
    p_change_given
  )
  RETURNING id INTO v_sale_id;

  -- Insert sale items
  INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal)
  SELECT
    v_sale_id,
    (item->>'product_id')::UUID,
    (item->>'quantity')::INTEGER,
    (item->>'price')::DECIMAL(10,2),
    (item->>'subtotal')::DECIMAL(10,2)
  FROM jsonb_array_elements(p_sale_items) AS item;

  -- Deduct change from cash_on_hand atomically (only if change > 0)
  IF p_change_given > 0 THEN
    UPDATE users
    SET cash_on_hand = cash_on_hand - p_change_given
    WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object('sale_id', v_sale_id);
END;
$$;
