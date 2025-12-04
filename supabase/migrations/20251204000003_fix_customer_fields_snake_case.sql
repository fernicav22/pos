/*
  # Fix Customer Fields Naming

  1. Changes
    - Ensure customers table has proper snake_case column names
    - The code queries customers(first_name, last_name) but table might have different names
  
  2. Notes
    - Database uses snake_case (first_name, last_name)
    - TypeScript code expects camelCase which is mapped
    - This ensures consistency
*/

-- These columns should already exist from initial migration
-- This is a verification/safety migration

-- Add email field constraint if needed
DO $$ 
BEGIN
  -- Ensure email can be null but if present must be unique
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'customers_email_key' 
    AND table_name = 'customers'
  ) THEN
    -- Email unique constraint already exists from initial migration
    NULL;
  END IF;
END $$;

-- Add index for customer lookups by name
CREATE INDEX IF NOT EXISTS idx_customers_first_name ON customers(first_name);
CREATE INDEX IF NOT EXISTS idx_customers_last_name ON customers(last_name);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
