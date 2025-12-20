-- Optimize authentication performance
-- Replace slow EXISTS subqueries with JWT role claims (no table lookup)

-- Fix product policy
DROP POLICY IF EXISTS "Admin and managers can modify products" ON products;
CREATE POLICY "Admin and managers can modify products" ON products
  FOR ALL TO authenticated 
  USING (auth.jwt() ->> 'role' IN ('admin', 'manager'));

-- Fix category policy (if it has same issue)
DROP POLICY IF EXISTS "Admin and managers can modify categories" ON categories;
CREATE POLICY "Admin and managers can modify categories" ON categories
  FOR ALL TO authenticated 
  USING (auth.jwt() ->> 'role' IN ('admin', 'manager'));

-- Update statistics
ANALYZE users;
ANALYZE products;
ANALYZE categories;
