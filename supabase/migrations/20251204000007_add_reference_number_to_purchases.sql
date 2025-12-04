/*
  # Add Reference Number to Purchases

  1. Changes
    - Ensure purchases table has reference_number field
    - This should exist from the aged_lodge migration but verifying
  
  2. Notes
    - Code creates purchases with reference_number
*/

-- Verify reference_number exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'purchases' AND column_name = 'reference_number'
  ) THEN
    ALTER TABLE purchases ADD COLUMN reference_number TEXT;
  END IF;
END $$;

-- Add index for reference number lookups
CREATE INDEX IF NOT EXISTS idx_purchases_reference_number ON purchases(reference_number);

-- Make sure we have updated_at trigger on purchases table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_purchases_updated_at'
  ) THEN
    CREATE TRIGGER update_purchases_updated_at
      BEFORE UPDATE ON purchases
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
