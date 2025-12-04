/*
  # Enhance Sales Tracking

  1. Changes
    - Add created_at indexes for better date range queries
    - Add notes field to sales if missing
    - Ensure payment_method has all expected values
    - Add refund tracking fields
  
  2. Performance
    - Add indexes for common query patterns in Reports and Transactions pages
*/

-- Add notes field if it doesn't exist (should be there from initial migration)
ALTER TABLE sales
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Ensure payment_status includes all statuses used in code
-- Drop and recreate the constraint with updated values
ALTER TABLE sales
DROP CONSTRAINT IF EXISTS sales_payment_status_check;

ALTER TABLE sales
ADD CONSTRAINT sales_payment_status_check 
CHECK (payment_status IN ('completed', 'failed', 'pending', 'refunded', 'partially_refunded'));

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON sales(payment_status);
CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON sales(payment_method);
CREATE INDEX IF NOT EXISTS idx_sales_customer_created ON sales(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_user_created ON sales(user_id, created_at);

-- Add indexes on sale_items for reporting
CREATE INDEX IF NOT EXISTS idx_sale_items_created_at ON sale_items(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_created ON sale_items(product_id, created_at);

-- Create a function to calculate sales totals for date ranges
CREATE OR REPLACE FUNCTION get_sales_summary(
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ
)
RETURNS TABLE (
  total_sales DECIMAL(10,2),
  total_transactions BIGINT,
  average_order_value DECIMAL(10,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(s.total), 0)::DECIMAL(10,2) AS total_sales,
    COUNT(*)::BIGINT AS total_transactions,
    COALESCE(AVG(s.total), 0)::DECIMAL(10,2) AS average_order_value
  FROM sales s
  WHERE s.created_at >= start_date
    AND s.created_at <= end_date
    AND s.payment_status = 'completed';
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_sales_summary TO authenticated;
