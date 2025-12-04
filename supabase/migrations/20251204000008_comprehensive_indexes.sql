/*
  # Comprehensive Performance Indexes

  1. Changes
    - Add all missing indexes for optimal query performance
    - Cover common join patterns and filter conditions
  
  2. Performance Improvements
    - Reports page date range queries
    - Transaction search and filtering
    - Product search and category filtering
    - Customer search
*/

-- Enable pg_trgm extension for fuzzy text search (must be before indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Products table indexes
CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category_id, active);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin(name gin_trgm_ops);

-- Categories table indexes
CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);

-- Sales table composite indexes
CREATE INDEX IF NOT EXISTS idx_sales_status_date ON sales(payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer_status ON sales(customer_id, payment_status) WHERE customer_id IS NOT NULL;

-- Sale items composite indexes
CREATE INDEX IF NOT EXISTS idx_sale_items_product_sale ON sale_items(product_id, sale_id);

-- Customers table indexes for search
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_email_trgm ON customers USING gin(email gin_trgm_ops) WHERE email IS NOT NULL;

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

-- Purchase items indexes
CREATE INDEX IF NOT EXISTS idx_purchase_items_received ON purchase_items(purchase_id, received_quantity);

-- Product variants indexes (if table exists)
CREATE INDEX IF NOT EXISTS idx_product_variants_active ON product_variants(active);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_active ON product_variants(product_id, active);
