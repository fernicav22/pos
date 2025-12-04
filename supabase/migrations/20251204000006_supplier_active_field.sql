/*
  # Supplier Active Field

  1. Changes
    - Ensure suppliers table has active field (should be there from initial migration)
    - Add indexes for supplier queries
  
  2. Notes
    - Purchases page queries suppliers with various filters
*/

-- Add indexes for supplier queries
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(active);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

-- Ensure active field exists with proper default
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'suppliers' AND column_name = 'active'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Add indexes for purchase queries
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
CREATE INDEX IF NOT EXISTS idx_purchases_payment_status ON purchases(payment_status);
CREATE INDEX IF NOT EXISTS idx_purchases_purchase_date ON purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_expected_delivery ON purchases(expected_delivery_date);
