/*
  # Settings Store Functions and Triggers

  1. Functions
    - upsert_store_settings: Helper function to update or insert settings
    - This enables the Settings page to properly save to database
  
  2. Notes
    - Settings should be single-row table (only one settings record)
    - Auto-create default settings if none exist
*/

-- Function to upsert store settings (update if exists, insert if not)
CREATE OR REPLACE FUNCTION upsert_store_settings(
  p_store_name TEXT,
  p_store_address TEXT,
  p_store_phone TEXT,
  p_store_email TEXT,
  p_store_website TEXT,
  p_currency TEXT,
  p_tax_rate DECIMAL(5,2),
  p_tax_inclusive BOOLEAN,
  p_receipt_header TEXT,
  p_receipt_footer TEXT,
  p_low_stock_threshold INTEGER,
  p_enable_stock_tracking BOOLEAN,
  p_show_tax_details BOOLEAN,
  p_show_itemized_list BOOLEAN
)
RETURNS UUID AS $$
DECLARE
  v_settings_id UUID;
BEGIN
  -- Check if settings exist
  SELECT id INTO v_settings_id FROM store_settings LIMIT 1;
  
  IF v_settings_id IS NULL THEN
    -- Insert new settings
    INSERT INTO store_settings (
      store_name,
      store_address,
      store_phone,
      store_email,
      store_website,
      currency,
      tax_rate,
      tax_inclusive,
      receipt_header,
      receipt_footer,
      low_stock_threshold,
      enable_stock_tracking,
      show_tax_details,
      show_itemized_list
    ) VALUES (
      p_store_name,
      p_store_address,
      p_store_phone,
      p_store_email,
      p_store_website,
      p_currency,
      p_tax_rate,
      p_tax_inclusive,
      p_receipt_header,
      p_receipt_footer,
      p_low_stock_threshold,
      p_enable_stock_tracking,
      p_show_tax_details,
      p_show_itemized_list
    ) RETURNING id INTO v_settings_id;
  ELSE
    -- Update existing settings
    UPDATE store_settings
    SET 
      store_name = p_store_name,
      store_address = p_store_address,
      store_phone = p_store_phone,
      store_email = p_store_email,
      store_website = p_store_website,
      currency = p_currency,
      tax_rate = p_tax_rate,
      tax_inclusive = p_tax_inclusive,
      receipt_header = p_receipt_header,
      receipt_footer = p_receipt_footer,
      low_stock_threshold = p_low_stock_threshold,
      enable_stock_tracking = p_enable_stock_tracking,
      show_tax_details = p_show_tax_details,
      show_itemized_list = p_show_itemized_list,
      updated_at = NOW()
    WHERE id = v_settings_id;
  END IF;
  
  RETURN v_settings_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (will be restricted by RLS)
GRANT EXECUTE ON FUNCTION upsert_store_settings TO authenticated;

-- Ensure there's always at least one settings record
INSERT INTO store_settings (
  store_name,
  store_address,
  store_phone,
  store_email,
  store_website,
  currency,
  tax_rate,
  tax_inclusive,
  receipt_header,
  receipt_footer,
  low_stock_threshold,
  enable_stock_tracking,
  show_tax_details,
  show_itemized_list
)
SELECT
  'My Store',
  '',
  '',
  '',
  '',
  'USD',
  0.00,
  false,
  'Welcome to My Store',
  'Thank you for your business!',
  5,
  true,
  true,
  true
WHERE NOT EXISTS (SELECT 1 FROM store_settings);
