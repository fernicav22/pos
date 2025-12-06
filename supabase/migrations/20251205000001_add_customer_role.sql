/*
  # Add Customer Role
  
  1. Changes
    - Update users table CHECK constraint to include 'customer' role
    - Update RLS policies to handle customer role restrictions
    - Customer role has very limited access (only POS for draft orders)
  
  2. Security
    - Customer role cannot view transactions, purchases, reports, staff, or settings
    - Customer role can only access POS for creating draft orders
    - Customer role cannot complete sales (only save drafts)
*/

-- Drop existing CHECK constraint and add new one with 'customer' role
DO $$ 
BEGIN
  -- Drop the existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'users_role_check' 
    AND table_name = 'users'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;
  
  -- Add new constraint with customer role
  ALTER TABLE users ADD CONSTRAINT users_role_check 
    CHECK (role IN ('admin', 'manager', 'cashier', 'customer'));
END $$;

-- Update sales policies to prevent customer role from viewing sales
DROP POLICY IF EXISTS "Users can view all sales" ON sales;
CREATE POLICY "Users can view sales based on role" ON sales
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager', 'cashier')
    )
  );

-- Update sale_items policies to prevent customer role from viewing sale items
DROP POLICY IF EXISTS "Users can view all sale items" ON sale_items;
CREATE POLICY "Users can view sale items based on role" ON sale_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager', 'cashier')
    )
  );

-- Ensure customer role cannot create actual sales (only drafts)
DROP POLICY IF EXISTS "Users can create sales" ON sales;
CREATE POLICY "Non-customer users can create sales" ON sales
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager', 'cashier')
    )
  );

-- Update products policy to allow customer role to view products
-- (they need to see products to create draft orders)
DROP POLICY IF EXISTS "All users can view active products" ON products;
CREATE POLICY "Authenticated users can view active products" ON products
  FOR SELECT TO authenticated USING (active = true);

-- Update categories policy to allow customer role to view categories
DROP POLICY IF EXISTS "All users can view categories" ON categories;
CREATE POLICY "Authenticated users can view categories" ON categories
  FOR SELECT TO authenticated USING (true);

-- Prevent customer role from modifying products
DROP POLICY IF EXISTS "Admin and managers can modify products" ON products;
CREATE POLICY "Admin and managers can modify products" ON products
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Prevent customer role from accessing purchases
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchases') THEN
    DROP POLICY IF EXISTS "Admin and managers can view purchases" ON purchases;
    CREATE POLICY "Admin and managers can view purchases" ON purchases
      FOR SELECT TO authenticated USING (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('admin', 'manager')
        )
      );
  END IF;
END $$;

-- Prevent customer role from accessing suppliers
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'suppliers') THEN
    DROP POLICY IF EXISTS "Admin and managers can view suppliers" ON suppliers;
    CREATE POLICY "Admin and managers can view suppliers" ON suppliers
      FOR SELECT TO authenticated USING (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('admin', 'manager')
        )
      );
  END IF;
END $$;

-- Customer role should not be able to view or modify other customers
DROP POLICY IF EXISTS "All users can view and modify customers" ON customers;
CREATE POLICY "Non-customer users can view customers" ON customers
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager', 'cashier')
    )
  );

CREATE POLICY "Non-customer users can modify customers" ON customers
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager', 'cashier')
    )
  );
