-- Ensure all existing products have active field set to true
-- This migration fixes any products that might have null or false active status

UPDATE products 
SET active = true 
WHERE active IS NULL OR active = false;

-- Verify the change
DO $$
DECLARE
  inactive_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO inactive_count FROM products WHERE active = false OR active IS NULL;
  
  IF inactive_count > 0 THEN
    RAISE NOTICE 'Warning: % products still have active = false or NULL', inactive_count;
  ELSE
    RAISE NOTICE 'All products are now active';
  END IF;
END $$;
