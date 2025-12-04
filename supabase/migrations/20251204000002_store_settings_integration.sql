/*
  # Store Settings Database Integration

  1. Changes
    - Ensure store_settings table has all required fields
    - Add phone, email, and website fields for store information
    - Update default settings structure to match code expectations
  
  2. New Fields
    - store_phone: Store contact phone number
    - store_email: Store contact email
    - store_website: Store website URL
    - low_stock_threshold: Default threshold for low stock alerts
    - enable_stock_tracking: Enable/disable stock tracking feature
    - receipt_header: Custom header for receipts
    - show_tax_details: Show tax breakdown on receipts
    - show_itemized_list: Show itemized list on receipts
*/

-- Add missing fields to store_settings table
ALTER TABLE store_settings
ADD COLUMN IF NOT EXISTS store_phone TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS store_email TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS store_website TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS enable_stock_tracking BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS receipt_header TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS show_tax_details BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS show_itemized_list BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN DEFAULT false;

-- Update the initial settings with more comprehensive defaults
UPDATE store_settings
SET 
  store_phone = COALESCE(NULLIF(store_phone, ''), ''),
  store_email = COALESCE(NULLIF(store_email, ''), ''),
  store_website = COALESCE(NULLIF(store_website, ''), ''),
  low_stock_threshold = COALESCE(low_stock_threshold, 5),
  enable_stock_tracking = COALESCE(enable_stock_tracking, true),
  receipt_header = COALESCE(NULLIF(receipt_header, ''), 'Welcome to ' || store_name),
  show_tax_details = COALESCE(show_tax_details, true),
  show_itemized_list = COALESCE(show_itemized_list, true),
  tax_inclusive = COALESCE(tax_inclusive, false),
  updated_at = NOW()
WHERE id IS NOT NULL;

-- Create a function to get current settings
CREATE OR REPLACE FUNCTION get_store_settings()
RETURNS TABLE (
  id UUID,
  store_name TEXT,
  store_address TEXT,
  store_phone TEXT,
  store_email TEXT,
  store_website TEXT,
  currency TEXT,
  tax_rate DECIMAL(5,2),
  tax_inclusive BOOLEAN,
  receipt_header TEXT,
  receipt_footer TEXT,
  low_stock_threshold INTEGER,
  enable_stock_tracking BOOLEAN,
  show_tax_details BOOLEAN,
  show_itemized_list BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.store_name,
    s.store_address,
    s.store_phone,
    s.store_email,
    s.store_website,
    s.currency,
    s.tax_rate,
    s.tax_inclusive,
    s.receipt_header,
    s.receipt_footer,
    s.low_stock_threshold,
    s.enable_stock_tracking,
    s.show_tax_details,
    s.show_itemized_list,
    s.created_at,
    s.updated_at
  FROM store_settings s
  ORDER BY s.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;
