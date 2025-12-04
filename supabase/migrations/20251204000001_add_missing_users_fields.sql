/*
  # Add Missing User Fields

  1. Changes
    - Add first_name and last_name to users table (code expects these)
    - Update existing column names if they differ from expected
  
  2. Notes
    - The code queries users(first_name, last_name)
    - Current schema has first_name and last_name already, this migration ensures consistency
*/

-- Ensure first_name and last_name columns exist (they should from initial migration)
-- This is a safety check migration
DO $$ 
BEGIN
  -- Check if columns exist and are properly named
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'first_name'
  ) THEN
    ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'last_name'
  ) THEN
    ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
  END IF;
END $$;
