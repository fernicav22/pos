/*
  # Optimize System Queries and PostgREST Performance
  
  Based on slow query analysis:
  - Optimize PostgREST schema cache queries
  - Add indexes for RLS policy checks
  - Optimize foreign key lookups
  - Add composite indexes for common JOIN patterns
*/

-- ============================================
-- PART 1: PostgREST Performance Optimizations
-- ============================================

-- Create optimized views for PostgREST to reduce schema introspection overhead
CREATE OR REPLACE VIEW api_tables AS
SELECT 
  c.oid::int8 as id,
  n.nspname as schema,
  c.relname as name,
  c.relkind as kind,
  obj_description(c.oid) as description,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
  AND NOT pg_is_other_temp_schema(n.oid);

-- Grant access to the view
GRANT SELECT ON api_tables TO anon, authenticated;

-- ============================================
-- PART 2: RLS Policy Performance Indexes
-- ============================================

-- Index for user role checks in RLS policies
CREATE INDEX IF NOT EXISTS idx_users_id_role 
  ON users(id, role) 
  WHERE active = true;

-- Index for auth.uid() lookups
CREATE INDEX IF NOT EXISTS idx_users_auth_id 
  ON users(id) 
  WHERE id IS NOT NULL;

-- ============================================
-- PART 3: Foreign Key Performance Indexes
-- ============================================

-- Ensure all foreign key columns have indexes
CREATE INDEX IF NOT EXISTS idx_sales_customer_id 
  ON sales(customer_id) 
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_user_id 
  ON sales(user_id);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id 
  ON purchases(supplier_id);

CREATE INDEX IF NOT EXISTS idx_products_category_id 
  ON products(category_id) 
  WHERE category_id IS NOT NULL;

-- ============================================
-- PART 4: Composite Indexes for Common JOINs
-- ============================================

-- Composite index for sale_items to products join
CREATE INDEX IF NOT EXISTS idx_sale_items_product_composite 
  ON sale_items(product_id, sale_id, quantity, price);

-- Composite index for sales to customers join
CREATE INDEX IF NOT EXISTS idx_sales_customer_composite 
  ON sales(customer_id, created_at DESC, payment_status) 
  WHERE customer_id IS NOT NULL;

-- Composite index for purchase_items to products join
CREATE INDEX IF NOT EXISTS idx_purchase_items_composite 
  ON purchase_items(product_id, purchase_id, quantity, cost_per_unit);

-- ============================================
-- PART 5: Optimized Aggregation Functions
-- ============================================

-- Fast product stock status function
CREATE OR REPLACE FUNCTION get_product_stock_status()
RETURNS TABLE (
  id UUID,
  name TEXT,
  sku TEXT,
  stock_quantity INTEGER,
  stock_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    p.sku,
    p.stock_quantity,
    CASE 
      WHEN p.stock_quantity = 0 THEN 'out_of_stock'
      WHEN p.stock_quantity < 10 THEN 'low_stock'
      ELSE 'in_stock'
    END as stock_status
  FROM products p
  WHERE p.active = true
  ORDER BY 
    CASE 
      WHEN p.stock_quantity = 0 THEN 1
      WHEN p.stock_quantity < 10 THEN 2
      ELSE 3
    END,
    p.stock_quantity ASC;
END;
$$ LANGUAGE plpgsql;

-- Fast sales summary by date range
DROP FUNCTION IF EXISTS get_sales_summary(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION get_sales_summary(
  p_start_date DATE,
  p_end_date DATE,
  p_group_by TEXT DEFAULT 'day' -- 'day', 'week', 'month'
)
RETURNS TABLE (
  period TEXT,
  total_sales NUMERIC,
  transaction_count BIGINT,
  avg_transaction_value NUMERIC,
  unique_customers BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN p_group_by = 'day' THEN TO_CHAR(s.created_at, 'YYYY-MM-DD')
      WHEN p_group_by = 'week' THEN TO_CHAR(DATE_TRUNC('week', s.created_at), 'YYYY-MM-DD')
      WHEN p_group_by = 'month' THEN TO_CHAR(DATE_TRUNC('month', s.created_at), 'YYYY-MM')
      ELSE TO_CHAR(s.created_at, 'YYYY-MM-DD')
    END as period,
    SUM(s.total) as total_sales,
    COUNT(*) as transaction_count,
    AVG(s.total) as avg_transaction_value,
    COUNT(DISTINCT s.customer_id) as unique_customers
  FROM sales s
  WHERE s.created_at::date BETWEEN p_start_date AND p_end_date
    AND s.payment_status = 'completed'
  GROUP BY 1
  ORDER BY 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 6: Optimize Timezone Queries
-- ============================================

-- Cache timezone names in a table (for the slow pg_timezone_names query)
CREATE TABLE IF NOT EXISTS cached_timezones (
  name TEXT PRIMARY KEY,
  abbrev TEXT,
  utc_offset INTERVAL,
  is_dst BOOLEAN,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

-- Populate timezone cache
INSERT INTO cached_timezones (name, abbrev, utc_offset, is_dst)
SELECT name, abbrev, utc_offset, is_dst 
FROM pg_timezone_names
ON CONFLICT (name) DO UPDATE 
SET abbrev = EXCLUDED.abbrev,
    utc_offset = EXCLUDED.utc_offset,
    is_dst = EXCLUDED.is_dst,
    cached_at = NOW();

-- Create index for timezone lookups
CREATE INDEX ON cached_timezones(name);

-- Function to get timezone (use cache instead of pg_timezone_names)
CREATE OR REPLACE FUNCTION get_timezone_names()
RETURNS TABLE (name TEXT) AS $$
BEGIN
  -- Refresh cache if older than 24 hours
  IF NOT EXISTS (
    SELECT 1 FROM cached_timezones 
    WHERE cached_at > NOW() - INTERVAL '24 hours'
    LIMIT 1
  ) THEN
    INSERT INTO cached_timezones (name, abbrev, utc_offset, is_dst)
    SELECT tz.name, tz.abbrev, tz.utc_offset, tz.is_dst 
    FROM pg_timezone_names tz
    ON CONFLICT (name) DO UPDATE 
    SET abbrev = EXCLUDED.abbrev,
        utc_offset = EXCLUDED.utc_offset,
        is_dst = EXCLUDED.is_dst,
        cached_at = NOW();
  END IF;
  
  RETURN QUERY
  SELECT ct.name FROM cached_timezones ct ORDER BY ct.name;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 7: Batch Operation Optimizations
-- ============================================

-- Optimized batch insert for sale items
CREATE OR REPLACE FUNCTION batch_insert_sale_items(
  p_sale_id UUID,
  p_items JSONB
)
RETURNS SETOF sale_items AS $$
BEGIN
  RETURN QUERY
  INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, price, subtotal, discount)
  SELECT 
    p_sale_id,
    (item->>'product_id')::UUID,
    (item->>'variant_id')::UUID,
    (item->>'quantity')::INTEGER,
    (item->>'price')::NUMERIC,
    (item->>'subtotal')::NUMERIC,
    COALESCE((item->>'discount')::NUMERIC, 0)
  FROM jsonb_array_elements(p_items) AS item
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- Optimized batch update for product stock
CREATE OR REPLACE FUNCTION batch_update_product_stock(
  p_updates JSONB
)
RETURNS VOID AS $$
BEGIN
  UPDATE products p
  SET 
    stock_quantity = u.new_quantity,
    updated_at = NOW()
  FROM (
    SELECT 
      (item->>'product_id')::UUID as product_id,
      (item->>'quantity')::INTEGER as new_quantity
    FROM jsonb_array_elements(p_updates) AS item
  ) u
  WHERE p.id = u.product_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 8: Query Plan Optimization Hints
-- ============================================

-- Note: The following settings should be configured in postgresql.conf or via cloud provider settings
-- They cannot be set in migrations as ALTER SYSTEM requires being outside a transaction block
-- 
-- Recommended settings for SSD storage:
-- random_page_cost = 1.1
-- effective_cache_size = 4GB (or 25% of available RAM)
-- shared_buffers = 1GB (or 25% of available RAM)
-- work_mem = 16MB
-- maintenance_work_mem = 256MB
-- max_parallel_workers_per_gather = 2
-- max_parallel_workers = 8
--
-- For Supabase, use the project settings interface to configure these parameters.

-- ============================================
-- PART 9: Monitoring and Maintenance
-- ============================================

-- Create table for query performance monitoring
CREATE TABLE IF NOT EXISTS query_performance_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash TEXT NOT NULL,
  query_text TEXT,
  execution_time_ms NUMERIC NOT NULL,
  rows_returned INTEGER,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES users(id),
  metadata JSONB
);

CREATE INDEX ON query_performance_log(timestamp DESC);
CREATE INDEX ON query_performance_log(query_hash, timestamp DESC);
CREATE INDEX ON query_performance_log(execution_time_ms DESC) WHERE execution_time_ms > 100;

-- Function to log slow queries
CREATE OR REPLACE FUNCTION log_slow_query(
  p_query_text TEXT,
  p_execution_time_ms NUMERIC,
  p_rows_returned INTEGER DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  -- Only log queries slower than 100ms
  IF p_execution_time_ms > 100 THEN
    INSERT INTO query_performance_log (
      query_hash,
      query_text,
      execution_time_ms,
      rows_returned,
      user_id,
      metadata
    ) VALUES (
      MD5(p_query_text),
      LEFT(p_query_text, 1000), -- Truncate long queries
      p_execution_time_ms,
      p_rows_returned,
      auth.uid(),
      p_metadata
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Automatic cleanup of old performance logs
CREATE OR REPLACE FUNCTION cleanup_old_performance_logs()
RETURNS VOID AS $$
BEGIN
  DELETE FROM query_performance_log 
  WHERE timestamp < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 10: Enable Required Extensions
-- ============================================

-- Enable extensions for better performance monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ============================================
-- PART 11: Optimize Specific Slow Queries
-- ============================================

-- Create function to replace the complex recursive CTE query
CREATE OR REPLACE FUNCTION get_functions_with_details(
  p_schemas TEXT[] DEFAULT ARRAY['public']
)
RETURNS TABLE (
  schema_name TEXT,
  function_name TEXT,
  function_description TEXT,
  arguments JSONB,
  return_type TEXT,
  is_aggregate BOOLEAN,
  is_window BOOLEAN,
  is_set_returning BOOLEAN,
  volatility TEXT,
  language TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.nspname::TEXT as schema_name,
    p.proname::TEXT as function_name,
    obj_description(p.oid)::TEXT as function_description,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', a.argname,
          'type', format_type(a.argtype, NULL),
          'mode', a.argmode
        ) ORDER BY a.argposition
      ) FILTER (WHERE a.argname IS NOT NULL),
      '[]'::JSONB
    ) as arguments,
    pg_get_function_result(p.oid)::TEXT as return_type,
    p.prokind = 'a' as is_aggregate,
    p.prokind = 'w' as is_window,
    p.proretset as is_set_returning,
    CASE p.provolatile
      WHEN 'i' THEN 'immutable'
      WHEN 's' THEN 'stable'
      WHEN 'v' THEN 'volatile'
    END::TEXT as volatility,
    l.lanname::TEXT as language
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  LEFT JOIN LATERAL (
    SELECT 
      unnest(p.proargnames) as argname,
      unnest(p.proargtypes::oid[]) as argtype,
      unnest(p.proargmodes) as argmode,
      generate_series(1, array_length(p.proargnames, 1)) as argposition
  ) a ON true
  WHERE n.nspname = ANY(p_schemas)
    AND p.prokind IN ('f', 'a', 'w', 'p')
  GROUP BY n.nspname, p.oid, p.proname, p.prokind, p.proretset, p.provolatile, l.lanname;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION get_product_stock_status TO authenticated;
GRANT EXECUTE ON FUNCTION get_sales_summary TO authenticated;
GRANT EXECUTE ON FUNCTION get_timezone_names TO authenticated;
GRANT EXECUTE ON FUNCTION batch_insert_sale_items TO authenticated;
GRANT EXECUTE ON FUNCTION batch_update_product_stock TO authenticated;
GRANT EXECUTE ON FUNCTION log_slow_query TO authenticated;
GRANT SELECT ON cached_timezones TO authenticated;
