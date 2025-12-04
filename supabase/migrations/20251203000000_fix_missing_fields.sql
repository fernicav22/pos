/*
  # Fix Missing Database Fields

  1. Updates to Products Table
    - Add attributes JSONB field
    - Add product variants support
  
  2. Updates to Customers Table
    - Add loyalty_points field
    - Add total_purchases field
    - Add segment field
  
  3. Updates to Sales Table
    - Add discount field
    - Add subtotal field (if missing)
    - Update status enum to include refund statuses
  
  4. Updates to Sale Items Table
    - Add variant_id field
    - Add discount field
  
  5. Updates to Categories Table
    - Add parent_id field for hierarchy
  
  6. Create Product Variants Table
*/

-- Add missing fields to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}';

-- Create product_variants table
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  attributes JSONB DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for variants
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku);

-- Enable RLS on product_variants
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

-- Product variants policies
CREATE POLICY "All users can view active product variants" ON product_variants
  FOR SELECT TO authenticated USING (active = true);

CREATE POLICY "Admin and managers can modify product variants" ON product_variants
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Add missing fields to customers table
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_purchases DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'regular';

-- Add parent_id to categories for hierarchy
ALTER TABLE categories
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- Add missing fields to sales table
ALTER TABLE sales
ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2);

-- Update subtotal for existing sales
UPDATE sales
SET subtotal = total - tax + discount
WHERE subtotal IS NULL;

-- Make subtotal required after updating existing records
ALTER TABLE sales
ALTER COLUMN subtotal SET NOT NULL,
ALTER COLUMN subtotal SET DEFAULT 0;

-- Drop existing constraint and add new one with updated statuses
ALTER TABLE sales
DROP CONSTRAINT IF EXISTS sales_payment_status_check;

ALTER TABLE sales
ADD CONSTRAINT sales_payment_status_check 
CHECK (payment_status IN ('completed', 'failed', 'pending', 'refunded', 'partially_refunded'));

-- Add missing fields to sale_items table
ALTER TABLE sale_items
ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id),
ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0);

CREATE INDEX IF NOT EXISTS idx_sale_items_variant ON sale_items(variant_id);

-- Create trigger to update customer loyalty points and total purchases
CREATE OR REPLACE FUNCTION update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status = 'completed' AND NEW.customer_id IS NOT NULL THEN
    UPDATE customers
    SET 
      total_purchases = total_purchases + NEW.total,
      loyalty_points = loyalty_points + FLOOR(NEW.total / 10), -- 1 point per $10
      updated_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_customer_stats
  AFTER INSERT ON sales
  FOR EACH ROW
  WHEN (NEW.payment_status = 'completed' AND NEW.customer_id IS NOT NULL)
  EXECUTE FUNCTION update_customer_stats();

-- Update customer segments based on total purchases
CREATE OR REPLACE FUNCTION update_customer_segment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.total_purchases >= 10000 THEN
    NEW.segment = 'vip';
  ELSIF NEW.total_purchases >= 5000 THEN
    NEW.segment = 'premium';
  ELSIF NEW.total_purchases >= 1000 THEN
    NEW.segment = 'gold';
  ELSE
    NEW.segment = 'regular';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_customer_segment
  BEFORE UPDATE ON customers
  FOR EACH ROW
  WHEN (OLD.total_purchases IS DISTINCT FROM NEW.total_purchases)
  EXECUTE FUNCTION update_customer_segment();

-- Create view for product with variants
CREATE OR REPLACE VIEW products_with_variants AS
SELECT 
  p.*,
  COALESCE(
    json_agg(
      json_build_object(
        'id', pv.id,
        'product_id', pv.product_id,
        'name', pv.name,
        'sku', pv.sku,
        'price', pv.price,
        'stock_quantity', pv.stock_quantity,
        'attributes', pv.attributes,
        'active', pv.active
      )
    ) FILTER (WHERE pv.id IS NOT NULL),
    '[]'
  ) AS variants
FROM products p
LEFT JOIN product_variants pv ON p.id = pv.product_id
GROUP BY p.id;

-- Update the check_stock_before_sale function to handle variants
CREATE OR REPLACE FUNCTION check_stock_before_sale()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if sale is for a variant
  IF NEW.variant_id IS NOT NULL THEN
    -- Check variant stock
    IF EXISTS (
      SELECT 1 FROM product_variants
      WHERE id = NEW.variant_id
      AND stock_quantity < NEW.quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for variant %', NEW.variant_id;
    END IF;
    
    -- Reduce variant stock quantity
    UPDATE product_variants
    SET stock_quantity = stock_quantity - NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.variant_id;
  ELSE
    -- Check product stock
    IF EXISTS (
      SELECT 1 FROM products
      WHERE id = NEW.product_id
      AND stock_quantity < NEW.quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for product %', NEW.product_id;
    END IF;

    -- Reduce product stock quantity
    UPDATE products
    SET stock_quantity = stock_quantity - NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
