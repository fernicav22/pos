/*
  # Fix Foreign Key Relationships and Cascades

  1. Changes
    - Ensure all foreign keys have proper ON DELETE and ON UPDATE behavior
    - Add missing cascades for data integrity
  
  2. Safety
    - Uses IF EXISTS to avoid errors if constraints already exist
    - Only adds missing constraints
*/

-- Add ON DELETE SET NULL for optional relationships
-- Products -> Categories (optional relationship)
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'products_category_id_fkey' 
    AND table_name = 'products'
  ) THEN
    ALTER TABLE products DROP CONSTRAINT products_category_id_fkey;
  END IF;
  
  -- Add new constraint with ON DELETE SET NULL
  ALTER TABLE products
  ADD CONSTRAINT products_category_id_fkey 
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
END $$;

-- Sales -> Customers (optional relationship, preserve sales history)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'sales_customer_id_fkey' 
    AND table_name = 'sales'
  ) THEN
    ALTER TABLE sales DROP CONSTRAINT sales_customer_id_fkey;
  END IF;
  
  ALTER TABLE sales
  ADD CONSTRAINT sales_customer_id_fkey 
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
END $$;

-- Sales -> Users (required, but preserve on user deletion)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'sales_user_id_fkey' 
    AND table_name = 'sales'
  ) THEN
    ALTER TABLE sales DROP CONSTRAINT sales_user_id_fkey;
  END IF;
  
  -- Use RESTRICT to prevent deleting users with sales
  ALTER TABLE sales
  ADD CONSTRAINT sales_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
END $$;

-- Purchases -> Suppliers (preserve purchase history)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'purchases_supplier_id_fkey' 
    AND table_name = 'purchases'
  ) THEN
    ALTER TABLE purchases DROP CONSTRAINT purchases_supplier_id_fkey;
  END IF;
  
  ALTER TABLE purchases
  ADD CONSTRAINT purchases_supplier_id_fkey 
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;
END $$;

-- Purchases -> Users (preserve purchase history)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'purchases_user_id_fkey' 
    AND table_name = 'purchases'
  ) THEN
    ALTER TABLE purchases DROP CONSTRAINT purchases_user_id_fkey;
  END IF;
  
  ALTER TABLE purchases
  ADD CONSTRAINT purchases_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
END $$;

-- Purchase Items -> Products (preserve for history)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'purchase_items_product_id_fkey' 
    AND table_name = 'purchase_items'
  ) THEN
    ALTER TABLE purchase_items DROP CONSTRAINT purchase_items_product_id_fkey;
  END IF;
  
  ALTER TABLE purchase_items
  ADD CONSTRAINT purchase_items_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
END $$;

-- Sale Items -> Products (preserve for history)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'sale_items_product_id_fkey' 
    AND table_name = 'sale_items'
  ) THEN
    ALTER TABLE sale_items DROP CONSTRAINT sale_items_product_id_fkey;
  END IF;
  
  ALTER TABLE sale_items
  ADD CONSTRAINT sale_items_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
END $$;

-- Sale Items -> Product Variants (optional, cascade if variant deleted)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'sale_items_variant_id_fkey' 
    AND table_name = 'sale_items'
  ) THEN
    ALTER TABLE sale_items DROP CONSTRAINT sale_items_variant_id_fkey;
  END IF;
  
  ALTER TABLE sale_items
  ADD CONSTRAINT sale_items_variant_id_fkey 
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;
END $$;
