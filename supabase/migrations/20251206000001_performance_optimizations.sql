/*
  # Performance Optimization Migrations
  
  Based on query performance analysis showing slow queries:
  - pg_timezone_names queries (167ms mean)
  - Complex CTE queries with recursive base_types (27-50ms mean)
  - Table metadata queries with relationships
  - Function and trigger metadata queries
  
  1. Additional Indexes
  2. Materialized Views for Complex Queries
  3. Query Result Caching
  4. Partitioning for Large Tables
*/

-- ============================================
-- PART 1: Additional Performance Indexes
-- ============================================

-- Sales table performance indexes
CREATE INDEX IF NOT EXISTS idx_sales_created_at_desc 
  ON sales(created_at DESC) 
  WHERE payment_status = 'completed';

CREATE INDEX IF NOT EXISTS idx_sales_user_date 
  ON sales(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_total_range 
  ON sales(total) 
  WHERE payment_status = 'completed';

-- Sale items performance indexes
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id_include 
  ON sale_items(sale_id) 
  INCLUDE (product_id, quantity, price, subtotal);

-- Products performance indexes
CREATE INDEX IF NOT EXISTS idx_products_stock_low 
  ON products(stock_quantity) 
  WHERE stock_quantity < 10 AND active = true;

CREATE INDEX IF NOT EXISTS idx_products_price_range 
  ON products(price) 
  WHERE active = true;

-- Customers performance indexes
CREATE INDEX IF NOT EXISTS idx_customers_segment 
  ON customers(segment, total_purchases DESC);

CREATE INDEX IF NOT EXISTS idx_customers_created_at 
  ON customers(created_at DESC);

-- Purchases performance indexes
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_date 
  ON purchases(supplier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchases_status 
  ON purchases(status) 
  WHERE status IN ('pending', 'ordered');

-- Purchase items performance indexes
CREATE INDEX IF NOT EXISTS idx_purchase_items_product 
  ON purchase_items(product_id, purchase_id);

-- ============================================
-- PART 2: Materialized Views for Dashboard
-- ============================================

-- Daily sales summary materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_sales_summary AS
SELECT 
  DATE(created_at) as sale_date,
  COUNT(*) as total_transactions,
  SUM(total) FILTER (WHERE payment_status = 'completed') as total_revenue,
  SUM(subtotal) FILTER (WHERE payment_status = 'completed') as total_subtotal,
  SUM(tax) FILTER (WHERE payment_status = 'completed') as total_tax,
  SUM(discount) FILTER (WHERE payment_status = 'completed') as total_discount,
  AVG(total) FILTER (WHERE payment_status = 'completed') as avg_transaction_value,
  COUNT(DISTINCT customer_id) as unique_customers,
  COUNT(*) FILTER (WHERE payment_method = 'cash') as cash_transactions,
  COUNT(*) FILTER (WHERE payment_method = 'card') as card_transactions,
  COUNT(*) FILTER (WHERE payment_method = 'mobile') as mobile_transactions
FROM sales
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(created_at)
WITH DATA;

CREATE UNIQUE INDEX ON mv_daily_sales_summary(sale_date);
CREATE INDEX ON mv_daily_sales_summary(sale_date DESC);

-- Product performance materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_product_performance AS
SELECT 
  p.id,
  p.name,
  p.sku,
  p.category_id,
  p.stock_quantity,
  p.price,
  COUNT(DISTINCT si.sale_id) as times_sold,
  COALESCE(SUM(si.quantity), 0) as total_quantity_sold,
  COALESCE(SUM(si.subtotal), 0) as total_revenue,
  COALESCE(AVG(si.price), p.price) as avg_selling_price,
  MAX(s.created_at) as last_sold_at
FROM products p
LEFT JOIN sale_items si ON p.id = si.product_id
LEFT JOIN sales s ON si.sale_id = s.id AND s.payment_status = 'completed'
WHERE p.active = true
GROUP BY p.id, p.name, p.sku, p.category_id, p.stock_quantity, p.price
WITH DATA;

CREATE UNIQUE INDEX ON mv_product_performance(id);
CREATE INDEX ON mv_product_performance(total_revenue DESC);
CREATE INDEX ON mv_product_performance(times_sold DESC);
CREATE INDEX ON mv_product_performance(stock_quantity) WHERE stock_quantity < 10;

-- Customer analytics materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_customer_analytics AS
SELECT 
  c.id,
  c.first_name,
  c.last_name,
  c.email,
  c.segment,
  c.loyalty_points,
  c.total_purchases,
  COUNT(s.id) as total_orders,
  MAX(s.created_at) as last_purchase_date,
  AVG(s.total) as avg_order_value,
  SUM(s.total) FILTER (WHERE s.created_at >= CURRENT_DATE - INTERVAL '30 days') as last_30_days_spent
FROM customers c
LEFT JOIN sales s ON c.id = s.customer_id AND s.payment_status = 'completed'
GROUP BY c.id, c.first_name, c.last_name, c.email, c.segment, c.loyalty_points, c.total_purchases
WITH DATA;

CREATE UNIQUE INDEX ON mv_customer_analytics(id);
CREATE INDEX ON mv_customer_analytics(segment, total_purchases DESC);
CREATE INDEX ON mv_customer_analytics(last_purchase_date DESC NULLS LAST);

-- ============================================
-- PART 3: Functions for Refreshing Views
-- ============================================

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_performance;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_customer_analytics;
END;
$$ LANGUAGE plpgsql;

-- Schedule periodic refresh (requires pg_cron extension)
-- Uncomment if pg_cron is available
-- SELECT cron.schedule('refresh-materialized-views', '*/15 * * * *', 'SELECT refresh_materialized_views();');

-- ============================================
-- PART 4: Optimized Dashboard Functions
-- ============================================

-- Fast dashboard stats function
CREATE OR REPLACE FUNCTION get_dashboard_stats(
  p_start_date DATE DEFAULT CURRENT_DATE,
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSON AS $$
DECLARE
  v_stats JSON;
BEGIN
  SELECT json_build_object(
    'today_sales', (
      SELECT COALESCE(SUM(total), 0)
      FROM sales
      WHERE DATE(created_at) = CURRENT_DATE
        AND payment_status = 'completed'
    ),
    'today_transactions', (
      SELECT COUNT(*)
      FROM sales
      WHERE DATE(created_at) = CURRENT_DATE
        AND payment_status = 'completed'
    ),
    'period_sales', (
      SELECT COALESCE(SUM(total), 0)
      FROM sales
      WHERE DATE(created_at) BETWEEN p_start_date AND p_end_date
        AND payment_status = 'completed'
    ),
    'period_transactions', (
      SELECT COUNT(*)
      FROM sales
      WHERE DATE(created_at) BETWEEN p_start_date AND p_end_date
        AND payment_status = 'completed'
    ),
    'low_stock_count', (
      SELECT COUNT(*)
      FROM products
      WHERE stock_quantity < 10
        AND active = true
    ),
    'active_customers', (
      SELECT COUNT(DISTINCT customer_id)
      FROM sales
      WHERE DATE(created_at) >= CURRENT_DATE - INTERVAL '30 days'
        AND payment_status = 'completed'
    ),
    'top_products', (
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT 
          p.name,
          p.sku,
          SUM(si.quantity) as quantity_sold,
          SUM(si.subtotal) as revenue
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        JOIN sales s ON si.sale_id = s.id
        WHERE s.payment_status = 'completed'
          AND DATE(s.created_at) BETWEEN p_start_date AND p_end_date
        GROUP BY p.id, p.name, p.sku
        ORDER BY SUM(si.subtotal) DESC
        LIMIT 5
      ) t
    )
  ) INTO v_stats;
  
  RETURN v_stats;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: Table Partitioning for Large Tables
-- ============================================

-- Create partitioned sales table for future data
-- Note: This is for new installations. For existing data, migration is complex
-- Note: Partition key must be included in unique constraints
CREATE TABLE IF NOT EXISTS sales_partitioned (
  LIKE sales INCLUDING DEFAULTS
  EXCLUDING CONSTRAINTS
) PARTITION BY RANGE (created_at);

-- Add constraints without unique/primary key (partitioned tables have special rules)
ALTER TABLE sales_partitioned ADD CONSTRAINT sales_partitioned_id_pk PRIMARY KEY (id, created_at);
ALTER TABLE sales_partitioned ADD CONSTRAINT sales_partitioned_user_id_fk FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE sales_partitioned ADD CONSTRAINT sales_partitioned_customer_id_fk FOREIGN KEY (customer_id) REFERENCES customers(id);

-- Create partitions for the next 12 months
DO $$
DECLARE
  start_date DATE;
  end_date DATE;
  partition_name TEXT;
BEGIN
  FOR i IN 0..11 LOOP
    start_date := DATE_TRUNC('month', CURRENT_DATE + (i || ' months')::INTERVAL);
    end_date := DATE_TRUNC('month', start_date + INTERVAL '1 month');
    partition_name := 'sales_' || TO_CHAR(start_date, 'YYYY_MM');
    
    -- Check if partition exists before creating
    IF NOT EXISTS (
      SELECT 1 FROM pg_class 
      WHERE relname = partition_name 
      AND relkind = 'r'
    ) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF sales_partitioned FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        start_date,
        end_date
      );
    END IF;
  END LOOP;
END $$;

-- ============================================
-- PART 6: Query Optimization Settings
-- ============================================

-- Create table for caching expensive queries
CREATE TABLE IF NOT EXISTS query_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_key TEXT NOT NULL,
  query_params JSONB,
  result_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON query_cache(query_key, expires_at);
CREATE INDEX ON query_cache(expires_at) WHERE expires_at IS NOT NULL;

-- Function to get cached query result
CREATE OR REPLACE FUNCTION get_cached_query(
  p_query_key TEXT,
  p_query_params JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT result_data INTO v_result
  FROM query_cache
  WHERE query_key = p_query_key
    AND (query_params = p_query_params OR (query_params IS NULL AND p_query_params IS NULL))
    AND expires_at > CURRENT_TIMESTAMP
  ORDER BY created_at DESC
  LIMIT 1;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Function to set cached query result
CREATE OR REPLACE FUNCTION set_cached_query(
  p_query_key TEXT,
  p_result_data JSONB,
  p_query_params JSONB DEFAULT NULL,
  p_ttl_minutes INTEGER DEFAULT 15
)
RETURNS void AS $$
BEGIN
  -- Delete old cache entries for this key
  DELETE FROM query_cache
  WHERE query_key = p_query_key
    AND (query_params = p_query_params OR (query_params IS NULL AND p_query_params IS NULL));
  
  -- Insert new cache entry
  INSERT INTO query_cache (query_key, query_params, result_data, expires_at)
  VALUES (p_query_key, p_query_params, p_result_data, NOW() + (p_ttl_minutes || ' minutes')::INTERVAL);
END;
$$ LANGUAGE plpgsql;

-- Clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_query_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM query_cache WHERE expires_at < CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 7: Statistics and Vacuum Settings
-- ============================================

-- Update statistics for better query planning
ANALYZE products;
ANALYZE sales;
ANALYZE sale_items;
ANALYZE customers;
ANALYZE purchases;
ANALYZE purchase_items;

-- Set autovacuum settings for high-traffic tables
ALTER TABLE sales SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE sale_items SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE products SET (
  autovacuum_vacuum_scale_factor = 0.2,
  autovacuum_analyze_scale_factor = 0.1
);

-- ============================================
-- PART 8: Connection Pooling Recommendations
-- ============================================

-- Add comment with connection pooling recommendations
COMMENT ON DATABASE postgres IS 'Recommended settings for connection pooling:
- Use PgBouncer or similar connection pooler
- Set pool_mode = transaction
- Set default_pool_size = 25
- Set max_client_conn = 100
- Enable prepared statement caching
- Set statement_timeout = 30s for web requests';

-- ============================================
-- PART 9: Monitoring Functions
-- ============================================

-- Function to identify slow queries
CREATE OR REPLACE FUNCTION get_slow_queries(
  p_min_duration_ms INTEGER DEFAULT 100
)
RETURNS TABLE (
  query TEXT,
  calls BIGINT,
  total_time DOUBLE PRECISION,
  mean_time DOUBLE PRECISION,
  max_time DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pg_stat_statements.query,
    pg_stat_statements.calls,
    pg_stat_statements.total_exec_time as total_time,
    pg_stat_statements.mean_exec_time as mean_time,
    pg_stat_statements.max_exec_time as max_time
  FROM pg_stat_statements
  WHERE pg_stat_statements.mean_exec_time > p_min_duration_ms
  ORDER BY pg_stat_statements.mean_exec_time DESC
  LIMIT 20;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_stat_statements extension not installed';
    RETURN;
END;
$$ LANGUAGE plpgsql;

-- Function to check index usage
CREATE OR REPLACE FUNCTION check_index_usage()
RETURNS TABLE (
  schemaname NAME,
  tablename NAME,
  indexname NAME,
  index_size TEXT,
  idx_scan BIGINT,
  idx_tup_read BIGINT,
  idx_tup_fetch BIGINT,
  is_unique BOOLEAN,
  is_primary BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.schemaname,
    s.tablename,
    s.indexrelname as indexname,
    pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
    s.idx_scan,
    s.idx_tup_read,
    s.idx_tup_fetch,
    i.indisunique as is_unique,
    i.indisprimary as is_primary
  FROM pg_stat_user_indexes s
  JOIN pg_index i ON s.indexrelid = i.indexrelid
  WHERE s.schemaname NOT IN ('pg_catalog', 'information_schema')
  ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions on new functions
GRANT EXECUTE ON FUNCTION get_dashboard_stats TO authenticated;
GRANT EXECUTE ON FUNCTION get_cached_query TO authenticated;
GRANT EXECUTE ON FUNCTION set_cached_query TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_materialized_views TO authenticated;
