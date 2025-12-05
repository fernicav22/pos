-- Drop existing sales view policy
DROP POLICY IF EXISTS "Users can view all sales" ON sales;

-- Create new role-based policy for viewing sales
-- Admins and Managers can view all sales
-- Cashiers can only view their own sales
CREATE POLICY "Role-based sales viewing" ON sales
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND (
        users.role IN ('admin', 'manager')
        OR (users.role = 'cashier' AND sales.user_id = auth.uid())
      )
    )
  );

-- Drop existing sale_items view policy
DROP POLICY IF EXISTS "Users can view all sale items" ON sale_items;

-- Create new role-based policy for viewing sale items
-- Users can only view sale items for sales they have access to
CREATE POLICY "Role-based sale items viewing" ON sale_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM sales
      JOIN users ON users.id = auth.uid()
      WHERE sales.id = sale_items.sale_id
      AND (
        users.role IN ('admin', 'manager')
        OR (users.role = 'cashier' AND sales.user_id = auth.uid())
      )
    )
  );
