/*
  # Fix store settings duplicates and add uniqueness constraint

  1. Changes
    - Keep only the most recently updated store settings record
    - Add a check constraint to ensure only one record can exist
    - Update policies to handle upsert operations correctly

  2. Data Preservation
    - Keeps the most recent settings
    - No data loss for active settings
*/

-- First, keep only the most recently updated record
WITH latest_settings AS (
  SELECT id
  FROM store_settings
  ORDER BY updated_at DESC
  LIMIT 1
)
DELETE FROM store_settings
WHERE id NOT IN (SELECT id FROM latest_settings);

-- Add a check constraint to ensure only one record can exist
CREATE OR REPLACE FUNCTION check_single_settings_record()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM store_settings) > 0 AND TG_OP = 'INSERT' THEN
    -- If inserting and a record exists, update the existing record instead
    UPDATE store_settings
    SET 
      store_name = NEW.store_name,
      store_address = NEW.store_address,
      currency = NEW.currency,
      tax_rate = NEW.tax_rate,
      receipt_footer = NEW.receipt_footer,
      updated_at = NOW();
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS ensure_single_settings_record ON store_settings;
CREATE TRIGGER ensure_single_settings_record
  BEFORE INSERT ON store_settings
  FOR EACH ROW
  EXECUTE FUNCTION check_single_settings_record();

-- Update policies to handle the single record case
DROP POLICY IF EXISTS "Allow admin/manager to insert store settings" ON store_settings;
DROP POLICY IF EXISTS "Allow admin/manager to update store settings" ON store_settings;

CREATE POLICY "Allow admin/manager to modify store settings"
  ON store_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );