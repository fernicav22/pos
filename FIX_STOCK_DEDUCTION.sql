/*
  FIX: Add SECURITY DEFINER to trigger functions to bypass RLS
  This allows stock deduction to work for all user roles
*/

-- Drop existing triggers
DROP TRIGGER IF EXISTS check_stock_before_sale ON sale_items;
DROP TRIGGER IF EXISTS prevent_out_of_stock_sales ON sale_items;

-- Recreate function WITH SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.check_stock_before_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  -- Check if sale is for a variant
  IF NEW.variant_id IS NOT NULL THEN
    -- Check variant stock
    IF EXISTS (
      SELECT 1 FROM product_variants
      WHERE id = NEW.variant_id
      AND stock_quantity < NEW.quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for variant %', NEW.variant_id;
    END IF;
    
    -- Reduce variant stock quantity
    UPDATE product_variants
    SET stock_quantity = stock_quantity - NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.variant_id;
  ELSE
    -- Check product stock
    IF EXISTS (
      SELECT 1 FROM products
      WHERE id = NEW.product_id
      AND stock_quantity < NEW.quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for product %', NEW.product_id;
    END IF;

    -- Reduce product stock quantity
    UPDATE products
    SET stock_quantity = stock_quantity - NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.product_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Recreate the trigger
CREATE TRIGGER check_stock_before_sale
  BEFORE INSERT ON sale_items
  FOR EACH ROW
  EXECUTE FUNCTION check_stock_before_sale();

-- Also fix the purchase trigger if it exists
DROP TRIGGER IF EXISTS increase_stock_on_purchase ON purchase_items;

CREATE OR REPLACE FUNCTION public.increase_stock_on_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  -- Check if purchase is for a variant
  IF NEW.variant_id IS NOT NULL THEN
    -- Increase variant stock quantity
    UPDATE product_variants
    SET stock_quantity = stock_quantity + NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.variant_id;
  ELSE
    -- Increase product stock quantity
    UPDATE products
    SET stock_quantity = stock_quantity + NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.product_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Recreate the trigger
CREATE TRIGGER increase_stock_on_purchase
  AFTER INSERT ON purchase_items
  FOR EACH ROW
  EXECUTE FUNCTION increase_stock_on_purchase();

-- Verify the fix
SELECT 
  proname as function_name,
  prosecdef as has_security_definer
FROM pg_proc
WHERE proname IN ('check_stock_before_sale', 'increase_stock_on_purchase')
ORDER BY proname;
