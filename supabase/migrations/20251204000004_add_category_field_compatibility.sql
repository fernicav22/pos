/*
  # Category Field Compatibility

  1. Changes
    - Add virtual 'category' field to products for backward compatibility
    - The code displays product.category in Products.tsx
    - Create a view or ensure category_id relationship works
  
  2. Notes
    - Products table has category_id (UUID reference)
    - Code sometimes expects a string 'category' field
    - This adds compatibility without breaking existing structure
*/

-- Create a view that includes category name directly
CREATE OR REPLACE VIEW products_with_category AS
SELECT 
  p.*,
  c.name AS category,
  c.id AS category_id_ref
FROM products p
LEFT JOIN categories c ON p.category_id = c.id;

-- Grant appropriate permissions to the view
GRANT SELECT ON products_with_category TO authenticated;

-- Ensure products table has proper indexes
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_stock_quantity ON products(stock_quantity);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

-- Add index for low stock alerts
CREATE INDEX IF NOT EXISTS idx_products_low_stock 
ON products(stock_quantity, low_stock_alert) 
WHERE stock_quantity <= low_stock_alert AND active = true;
