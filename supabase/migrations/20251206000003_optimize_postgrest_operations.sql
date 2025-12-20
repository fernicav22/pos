/*
  # Optimize PostgREST Insert/Update Operations
  
  Based on slow query analysis showing:
  - Slow INSERT operations on sale_items (17.45ms mean)
  - Slow UPDATE operations on products (12.52ms mean)
  - Slow INSERT operations on refresh_tokens and sessions
  
  1. Optimize triggers that run on INSERT/UPDATE
  2. Add partial indexes for common WHERE clauses
  3. Optimize RLS policies
  4. Add database-level caching for frequently accessed data
*/

-- ============================================
-- PART 1: Optimize Triggers
-- ============================================

-- Optimize the check_stock_before_sale trigger
DROP TRIGGER IF EXISTS check_stock_before_sale ON sale_items;

CREATE OR REPLACE FUNCTION check_stock_before_sale_optimized()
RETURNS TRIGGER AS $$
DECLARE
  v_stock_quantity INTEGER;
  v_product_name TEXT;
BEGIN
  -- Use a single query to check and get stock info
  IF NEW.variant_id IS NOT NULL THEN
    SELECT stock_quantity, name INTO v_stock_quantity, v_product_name
    FROM product_variants
    WHERE id = NEW.variant_id
    FOR UPDATE NOWAIT; -- Prevent lock waiting
    
    IF v_stock_quantity < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for variant % (available: %, requested: %)', 
        v_product_name, v_stock_quantity, NEW.quantity;
    END IF;
    
    -- Update stock in the same transaction
    UPDATE product_variants
    SET stock_quantity = stock_quantity - NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.variant_id;
  ELSE
    SELECT stock_quantity, name INTO v_stock_quantity, v_product_name
    FROM products
    WHERE id = NEW.product_id
    FOR UPDATE NOWAIT; -- Prevent lock waiting
    
    IF v_stock_quantity < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product % (available: %, requested: %)', 
        v_product_name, v_stock_quantity, NEW.quantity;
    END IF;
    
    -- Update stock in the same transaction
    UPDATE products
    SET stock_quantity = stock_quantity - NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_stock_before_sale
  BEFORE INSERT ON sale_items
  FOR EACH ROW
  EXECUTE FUNCTION check_stock_before_sale_optimized();

-- Optimize the update_updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_optimized()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update if actual data changed (not just touched)
  IF OLD IS DISTINCT FROM NEW THEN
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply optimized trigger to all tables with updated_at
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename IN ('products', 'customers', 'sales', 'purchases', 'suppliers', 'categories')
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS update_%s_updated_at ON %I;
      CREATE TRIGGER update_%s_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_optimized();
    ', t.tablename, t.tablename, t.tablename, t.tablename);
  END LOOP;
END $$;

-- ============================================
-- PART 2: Optimize RLS Policies
-- ============================================

-- Drop and recreate RLS policies with better performance

-- Optimize products RLS
DROP POLICY IF EXISTS "All users can view active products" ON products;
CREATE POLICY "All users can view active products" ON products
  FOR SELECT TO authenticated 
  USING (active = true);

DROP POLICY IF EXISTS "Admin and managers can modify products" ON products;
CREATE POLICY "Admin and managers can modify products" ON products
  FOR ALL TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'manager')
      AND u.active = true
      LIMIT 1
    )
  );

-- Optimize sales RLS
DROP POLICY IF EXISTS "Users can view their own sales" ON sales;
CREATE POLICY "Users can view their own sales" ON sales
  FOR SELECT TO authenticated 
  USING (
    user_id = auth.uid() 
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'manager')
      AND u.active = true
      LIMIT 1
    )
  );

-- ============================================
-- PART 3: Partial Indexes for Common Queries
-- ============================================

-- Partial indexes for active records
CREATE INDEX IF NOT EXISTS idx_products_active_true 
  ON products(id, name, sku, price, stock_quantity) 
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_users_active_true 
  ON users(id, email, role) 
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_suppliers_active_true 
  ON suppliers(id, name) 
  WHERE active = true;

-- Partial indexes for payment status
CREATE INDEX IF NOT EXISTS idx_sales_completed 
  ON sales(created_at DESC, total) 
  WHERE payment_status = 'completed';

CREATE INDEX IF NOT EXISTS idx_sales_pending 
  ON sales(created_at DESC) 
  WHERE payment_status = 'pending';

-- ============================================
-- PART 4: Optimize PostgREST Bulk Operations
-- ============================================

-- Function for efficient bulk sale creation
CREATE OR REPLACE FUNCTION create_sale_with_items(
  p_sale JSONB,
  p_items JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_sale_id UUID;
  v_result JSONB;
BEGIN
  -- Insert sale
  INSERT INTO sales (
    user_id, customer_id, total, subtotal, tax, discount,
    payment_method, payment_status, notes
  )
  SELECT 
    (p_sale->>'user_id')::UUID,
    (p_sale->>'customer_id')::UUID,
    (p_sale->>'total')::NUMERIC,
    (p_sale->>'subtotal')::NUMERIC,
    (p_sale->>'tax')::NUMERIC,
    COALESCE((p_sale->>'discount')::NUMERIC, 0),
    p_sale->>'payment_method',
    COALESCE(p_sale->>'payment_status', 'completed'),
    p_sale->>'notes'
  RETURNING id INTO v_sale_id;
  
  -- Insert sale items in bulk
  INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, price, subtotal, discount)
  SELECT 
    v_sale_id,
    (item->>'product_id')::UUID,
    (item->>'variant_id')::UUID,
    (item->>'quantity')::INTEGER,
    (item->>'price')::NUMERIC,
    (item->>'subtotal')::NUMERIC,
    COALESCE((item->>'discount')::NUMERIC, 0)
  FROM jsonb_array_elements(p_items) AS item;
  
  -- Return the created sale with items
  SELECT jsonb_build_object(
    'sale_id', v_sale_id,
    'success', true,
    'items_count', jsonb_array_length(p_items)
  ) INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: Connection Pool Optimization
-- ============================================

-- Create a connection pool stats view
CREATE OR REPLACE VIEW connection_pool_stats AS
SELECT 
  count(*) as total_connections,
  count(*) FILTER (WHERE state = 'active') as active_connections,
  count(*) FILTER (WHERE state = 'idle') as idle_connections,
  count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
  max(EXTRACT(EPOCH FROM (now() - state_change))) as max_idle_time_seconds
FROM pg_stat_activity
WHERE datname = current_database();

GRANT SELECT ON connection_pool_stats TO authenticated;

-- ============================================
-- PART 6: Optimize Auth Tables
-- ============================================

-- Note: auth.refresh_tokens and auth.sessions are managed by Supabase
-- and cannot be modified in migrations. These tables already have
-- appropriate indexes configured by the Supabase system.

-- ============================================
-- PART 7: Query Result Caching Functions
-- ============================================

-- Cache frequently accessed product data
CREATE TABLE IF NOT EXISTS product_cache (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  cache_data JSONB NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON product_cache(last_updated);

-- Function to get cached product data
CREATE OR REPLACE FUNCTION get_product_cached(p_product_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_cache_data JSONB;
  v_cache_age INTERVAL;
BEGIN
  -- Check cache
  SELECT cache_data, NOW() - last_updated 
  INTO v_cache_data, v_cache_age
  FROM product_cache 
  WHERE product_id = p_product_id;
  
  -- If cache is older than 5 minutes or doesn't exist, refresh it
  IF v_cache_data IS NULL OR v_cache_age > INTERVAL '5 minutes' THEN
    SELECT jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'sku', p.sku,
      'barcode', p.barcode,
      'price', p.price,
      'cost', p.cost,
      'stock_quantity', p.stock_quantity,
      'category', jsonb_build_object(
        'id', c.id,
        'name', c.name
      ),
      'active', p.active,
      'variants', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', pv.id,
            'name', pv.name,
            'sku', pv.sku,
            'price', pv.price,
            'stock_quantity', pv.stock_quantity
          )
        ) FILTER (WHERE pv.id IS NOT NULL),
        '[]'::jsonb
      )
    ) INTO v_cache_data
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN product_variants pv ON p.id = pv.product_id AND pv.active = true
    WHERE p.id = p_product_id
    GROUP BY p.id, c.id, c.name;
    
    -- Update cache
    INSERT INTO product_cache (product_id, cache_data)
    VALUES (p_product_id, v_cache_data)
    ON CONFLICT (product_id) DO UPDATE
    SET cache_data = EXCLUDED.cache_data,
        last_updated = NOW();
  END IF;
  
  RETURN v_cache_data;
END;
$$ LANGUAGE plpgsql;

-- Trigger to invalidate cache on product update
CREATE OR REPLACE FUNCTION invalidate_product_cache()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM product_cache WHERE product_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_invalidate_product_cache
  AFTER UPDATE ON products
  FOR EACH ROW
  WHEN (OLD IS DISTINCT FROM NEW)
  EXECUTE FUNCTION invalidate_product_cache();

-- ============================================
-- PART 8: Optimize Aggregation Queries
-- ============================================

-- Create summary table for daily stats
CREATE TABLE IF NOT EXISTS daily_stats_cache (
  stat_date DATE PRIMARY KEY,
  total_sales NUMERIC,
  total_transactions INTEGER,
  unique_customers INTEGER,
  top_products JSONB,
  payment_methods JSONB,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON daily_stats_cache(stat_date DESC);

-- Function to update daily stats
CREATE OR REPLACE FUNCTION update_daily_stats(p_date DATE DEFAULT CURRENT_DATE)
RETURNS VOID AS $$
BEGIN
  INSERT INTO daily_stats_cache (
    stat_date,
    total_sales,
    total_transactions,
    unique_customers,
    top_products,
    payment_methods
  )
  SELECT 
    p_date,
    SUM(total),
    COUNT(*),
    COUNT(DISTINCT customer_id),
    (
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT p.name, SUM(si.quantity) as quantity, SUM(si.subtotal) as revenue
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        JOIN sales s ON si.sale_id = s.id
        WHERE DATE(s.created_at) = p_date
          AND s.payment_status = 'completed'
        GROUP BY p.id, p.name
        ORDER BY SUM(si.subtotal) DESC
        LIMIT 10
      ) t
    ),
    jsonb_build_object(
      'cash', COUNT(*) FILTER (WHERE payment_method = 'cash'),
      'card', COUNT(*) FILTER (WHERE payment_method = 'card'),
      'mobile', COUNT(*) FILTER (WHERE payment_method = 'mobile')
    )
  FROM sales
  WHERE DATE(created_at) = p_date
    AND payment_status = 'completed'
  ON CONFLICT (stat_date) DO UPDATE
  SET 
    total_sales = EXCLUDED.total_sales,
    total_transactions = EXCLUDED.total_transactions,
    unique_customers = EXCLUDED.unique_customers,
    top_products = EXCLUDED.top_products,
    payment_methods = EXCLUDED.payment_methods,
    last_updated = NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger to update daily stats on new sale
CREATE OR REPLACE FUNCTION trigger_update_daily_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status = 'completed' THEN
    PERFORM update_daily_stats(DATE(NEW.created_at));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_daily_stats_on_sale
  AFTER INSERT OR UPDATE ON sales
  FOR EACH ROW
  WHEN (NEW.payment_status = 'completed')
  EXECUTE FUNCTION trigger_update_daily_stats();

-- ============================================
-- PART 9: Grant Permissions
-- ============================================

GRANT EXECUTE ON FUNCTION create_sale_with_items TO authenticated;
GRANT EXECUTE ON FUNCTION get_product_cached TO authenticated;
GRANT EXECUTE ON FUNCTION update_daily_stats TO authenticated;
GRANT SELECT ON product_cache TO authenticated;
GRANT SELECT ON daily_stats_cache TO authenticated;

-- ============================================
-- PART 10: Vacuum and Analyze
-- ============================================

-- Note: VACUUM ANALYZE should be run separately outside of transactions
-- For Supabase, this is handled automatically by the system
-- To manually run (if needed):
-- VACUUM ANALYZE products;
-- VACUUM ANALYZE sales;
-- VACUUM ANALYZE sale_items;
-- VACUUM ANALYZE customers;
-- VACUUM ANALYZE users;
