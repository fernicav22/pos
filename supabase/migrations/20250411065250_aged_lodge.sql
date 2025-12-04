/*
  # Add Supplier Purchases System

  1. New Tables
    - `suppliers`
      - Supplier information and contact details
      - RLS: Admin and managers can read/write
    
    - `purchases`
      - Purchase orders from suppliers
      - Tracks total amount, status, and payment
      - RLS: Admin and managers can read/write
    
    - `purchase_items`
      - Individual items in each purchase
      - Links to products and tracks quantity/cost
      - RLS: Same access as purchases table

  2. Security
    - RLS enabled on all tables
    - Only admin and managers can access
*/

-- Suppliers table
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  tax_id TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Purchases table
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  user_id UUID NOT NULL REFERENCES users(id),
  reference_number TEXT,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery_date DATE,
  delivery_date DATE,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('draft', 'ordered', 'received', 'cancelled')) DEFAULT 'draft',
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'partial', 'paid')) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Purchase items table
CREATE TABLE purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  cost_per_unit DECIMAL(10,2) NOT NULL CHECK (cost_per_unit >= 0),
  subtotal DECIMAL(10,2) NOT NULL CHECK (subtotal >= 0),
  received_quantity INTEGER DEFAULT 0 CHECK (received_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;

-- Suppliers policies
CREATE POLICY "Admin and managers can view suppliers" ON suppliers
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admin and managers can modify suppliers" ON suppliers
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Purchases policies
CREATE POLICY "Admin and managers can view purchases" ON purchases
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admin and managers can modify purchases" ON purchases
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Purchase items policies
CREATE POLICY "Admin and managers can view purchase items" ON purchase_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admin and managers can modify purchase items" ON purchase_items
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Create indexes
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX idx_purchases_user ON purchases(user_id);
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX idx_purchase_items_product ON purchase_items(product_id);

-- Create trigger to update stock when purchase is received
CREATE OR REPLACE FUNCTION update_stock_on_purchase_receive()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'received' AND OLD.status != 'received' THEN
    -- Update product stock quantities
    UPDATE products p
    SET stock_quantity = p.stock_quantity + pi.received_quantity,
        updated_at = NOW()
    FROM purchase_items pi
    WHERE pi.purchase_id = NEW.id
    AND p.id = pi.product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_stock_on_purchase_receive
  AFTER UPDATE ON purchases
  FOR EACH ROW
  WHEN (NEW.status = 'received' AND OLD.status != 'received')
  EXECUTE FUNCTION update_stock_on_purchase_receive();

-- Create trigger to update purchase totals
CREATE OR REPLACE FUNCTION update_purchase_totals()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the purchase totals
  UPDATE purchases p
  SET subtotal = (
    SELECT COALESCE(SUM(subtotal), 0)
    FROM purchase_items
    WHERE purchase_id = p.id
  ),
  total = (
    SELECT COALESCE(SUM(subtotal), 0) + tax
    FROM purchase_items
    WHERE purchase_id = p.id
  ),
  updated_at = NOW()
  WHERE id = NEW.purchase_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_purchase_totals
  AFTER INSERT OR UPDATE OR DELETE ON purchase_items
  FOR EACH ROW
  EXECUTE FUNCTION update_purchase_totals();