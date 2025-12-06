/*
  # Create Draft Orders Table
  
  1. New Table
    - `draft_orders`
      - Stores incomplete/draft sales that can be saved and resumed later
      - Allows multiple users to work on different orders simultaneously
      - Used by customer role for order preparation
  
  2. Security
    - RLS enabled
    - Users can only view and manage their own draft orders
    - Admins and managers can view all draft orders
  
  3. Features
    - Auto-update timestamp trigger
    - Indexes for performance
    - JSONB storage for flexible cart items
*/

-- Create draft_orders table
CREATE TABLE IF NOT EXISTS draft_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  name TEXT, -- Optional name/label for the draft
  items JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of cart items
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  shipping DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (shipping >= 0),
  total DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_draft_orders_user_id ON draft_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_draft_orders_customer_id ON draft_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_draft_orders_created_at ON draft_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_draft_orders_updated_at ON draft_orders(updated_at DESC);

-- Create trigger for auto-updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_draft_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_draft_orders_updated_at ON draft_orders;
CREATE TRIGGER update_draft_orders_updated_at
  BEFORE UPDATE ON draft_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_draft_orders_updated_at();

-- Enable Row Level Security
ALTER TABLE draft_orders ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can view their own draft orders
CREATE POLICY "Users can view their own draft orders" ON draft_orders
  FOR SELECT TO authenticated USING (
    auth.uid() = user_id
  );

-- Admins and managers can view all draft orders
CREATE POLICY "Admins and managers can view all draft orders" ON draft_orders
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Users can create their own draft orders
CREATE POLICY "Users can create their own draft orders" ON draft_orders
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
  );

-- Users can update their own draft orders
CREATE POLICY "Users can update their own draft orders" ON draft_orders
  FOR UPDATE TO authenticated USING (
    auth.uid() = user_id
  );

-- Users can delete their own draft orders
CREATE POLICY "Users can delete their own draft orders" ON draft_orders
  FOR DELETE TO authenticated USING (
    auth.uid() = user_id
  );

-- Admins and managers can delete any draft orders
CREATE POLICY "Admins and managers can delete any draft orders" ON draft_orders
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Add comment to table
COMMENT ON TABLE draft_orders IS 'Stores draft/incomplete sales that can be saved and resumed later. Allows multiple concurrent orders and is used by customer role for order preparation.';
COMMENT ON COLUMN draft_orders.items IS 'JSONB array of cart items with structure: [{id, name, sku, price, cost, quantity, stock_quantity}]';
COMMENT ON COLUMN draft_orders.name IS 'Optional user-defined name/label for the draft order';
