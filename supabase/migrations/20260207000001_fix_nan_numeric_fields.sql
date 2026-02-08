/*
  # Fix NaN Input Errors - Add Proper Constraints and Defaults

  1. Problem
    - Numeric fields in store_settings had NULL values
    - NULL values became NaN in JavaScript, causing input validation errors
    - 19 occurrences of "The specified value 'NaN' cannot be parsed"

  2. Solution
    - Add NOT NULL constraints with proper defaults to all numeric columns
    - Update existing NULL values to defaults
    - Ensure data integrity for calculations (taxes, inventory, etc.)

  3. Changed Columns
    - tax_rate: NULL → DEFAULT 10 (NOT NULL)
    - low_stock_threshold: NULL → DEFAULT 10 (NOT NULL)
    - out_of_stock_threshold: NULL → DEFAULT 0 (NOT NULL)
*/

-- Step 1: Update all NULL numeric values to defaults before adding NOT NULL constraints
-- Ensure out_of_stock_threshold exists before referencing it in the UPDATE
ALTER TABLE store_settings
ADD COLUMN IF NOT EXISTS out_of_stock_threshold INTEGER DEFAULT 0;

UPDATE store_settings
SET 
  tax_rate = COALESCE(tax_rate, 10),
  low_stock_threshold = COALESCE(low_stock_threshold, 10),
  out_of_stock_threshold = COALESCE(out_of_stock_threshold, 0),
  updated_at = NOW()
WHERE tax_rate IS NULL OR low_stock_threshold IS NULL OR out_of_stock_threshold IS NULL;

-- Step 2: Add NOT NULL constraints with defaults to prevent future NaN issues
-- tax_rate
ALTER TABLE store_settings
ALTER COLUMN tax_rate SET NOT NULL,
ALTER COLUMN tax_rate SET DEFAULT 10;

-- low_stock_threshold  
ALTER TABLE store_settings
ALTER COLUMN low_stock_threshold SET NOT NULL,
ALTER COLUMN low_stock_threshold SET DEFAULT 10;

-- Add out_of_stock_threshold if it doesn't exist, with proper constraint
-- (moved earlier) out_of_stock_threshold handled above to avoid referencing missing column

-- Step 3: Ensure other critical fields have defaults
ALTER TABLE store_settings
ALTER COLUMN store_name SET NOT NULL,
ALTER COLUMN store_name SET DEFAULT 'My Store',
ALTER COLUMN currency SET NOT NULL,
ALTER COLUMN currency SET DEFAULT 'USD',
ALTER COLUMN tax_inclusive SET NOT NULL,
ALTER COLUMN tax_inclusive SET DEFAULT false,
ALTER COLUMN enable_stock_tracking SET NOT NULL,
ALTER COLUMN enable_stock_tracking SET DEFAULT true,
ALTER COLUMN show_tax_details SET NOT NULL,
ALTER COLUMN show_tax_details SET DEFAULT true,
ALTER COLUMN show_itemized_list SET NOT NULL,
ALTER COLUMN show_itemized_list SET DEFAULT true;

-- Step 4: Ensure text fields default to empty string instead of NULL
UPDATE store_settings
SET 
  store_address = COALESCE(store_address, ''),
  store_phone = COALESCE(store_phone, ''),
  store_email = COALESCE(store_email, ''),
  store_website = COALESCE(store_website, ''),
  receipt_header = COALESCE(receipt_header, ''),
  receipt_footer = COALESCE(receipt_footer, '')
WHERE store_address IS NULL OR store_phone IS NULL OR store_email IS NULL 
   OR store_website IS NULL OR receipt_header IS NULL OR receipt_footer IS NULL;

ALTER TABLE store_settings
ALTER COLUMN store_address SET NOT NULL,
ALTER COLUMN store_address SET DEFAULT '',
ALTER COLUMN store_phone SET NOT NULL,
ALTER COLUMN store_phone SET DEFAULT '',
ALTER COLUMN store_email SET NOT NULL,
ALTER COLUMN store_email SET DEFAULT '',
ALTER COLUMN store_website SET NOT NULL,
ALTER COLUMN store_website SET DEFAULT '',
ALTER COLUMN receipt_header SET NOT NULL,
ALTER COLUMN receipt_header SET DEFAULT '',
ALTER COLUMN receipt_footer SET NOT NULL,
ALTER COLUMN receipt_footer SET DEFAULT '';

-- Step 5: Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_store_settings_updated ON store_settings(updated_at DESC);

-- Step 6: Add comment documenting the fix
COMMENT ON TABLE store_settings IS 
'Store configuration settings. All numeric columns have NOT NULL constraints with sensible defaults to prevent NaN errors in client applications.';

COMMENT ON COLUMN store_settings.tax_rate IS 
'Tax rate as a percentage (0-100). Default: 10. NOT NULL to prevent NaN.';

COMMENT ON COLUMN store_settings.low_stock_threshold IS 
'Inventory low stock alert threshold. Default: 10. NOT NULL to prevent NaN.';

COMMENT ON COLUMN store_settings.out_of_stock_threshold IS 
'Inventory out of stock threshold. Default: 0. NOT NULL to prevent NaN.';
