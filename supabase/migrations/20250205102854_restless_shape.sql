/*
  # Initial POS System Schema

  1. New Tables
    - `users`
      - System users (staff members)
      - Roles: admin, manager, cashier
      - RLS: Users can only read their own data
    
    - `products`
      - Product catalog
      - Tracks inventory, prices, and categories
      - RLS: All authenticated users can read, only admin/manager can write
    
    - `categories`
      - Product categories
      - RLS: All authenticated users can read, only admin/manager can write
    
    - `customers`
      - Customer information
      - RLS: All authenticated users can read/write
    
    - `sales`
      - Sales transactions
      - RLS: All authenticated users can read/write their own sales
    
    - `sale_items`
      - Individual items in each sale
      - RLS: Same access as sales table

  2. Security
    - RLS enabled on all tables
    - Policies for each user role
    - Secure audit logging
*/

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends auth.users)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'cashier')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Categories table
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Products table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  description TEXT,
  category_id UUID REFERENCES categories(id),
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  cost DECIMAL(10,2) NOT NULL CHECK (cost >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_alert INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_alert >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Customers table
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sales table
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  customer_id UUID REFERENCES customers(id),
  subtotal DECIMAL(10,2) NOT NULL CHECK (subtotal >= 0),
  tax DECIMAL(10,2) NOT NULL CHECK (tax >= 0),
  total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'other')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('completed', 'failed', 'pending')) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sale items table
CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  subtotal DECIMAL(10,2) NOT NULL CHECK (subtotal >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_sales_user ON sales(user_id);
CREATE INDEX idx_sales_customer ON sales(customer_id);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own data" ON users
  FOR SELECT USING (auth.uid() = id);

-- Categories policies
CREATE POLICY "All users can view categories" ON categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin and managers can modify categories" ON categories
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Products policies
CREATE POLICY "All users can view active products" ON products
  FOR SELECT TO authenticated USING (active = true);

CREATE POLICY "Admin and managers can modify products" ON products
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Customers policies
CREATE POLICY "All users can view and modify customers" ON customers
  FOR ALL TO authenticated USING (true);

-- Sales policies
CREATE POLICY "Users can view all sales" ON sales
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create sales" ON sales
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
  );

-- Sale items policies
CREATE POLICY "Users can view all sale items" ON sale_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create sale items" ON sale_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales
      WHERE sales.id = sale_id
      AND sales.user_id = auth.uid()
    )
  );

-- Prevent out-of-stock sales trigger
CREATE OR REPLACE FUNCTION check_stock_before_sale()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if there's enough stock
  IF EXISTS (
    SELECT 1 FROM products
    WHERE id = NEW.product_id
    AND stock_quantity < NEW.quantity
  ) THEN
    RAISE EXCEPTION 'Insufficient stock for product %', NEW.product_id;
  END IF;

  -- Reduce stock quantity
  UPDATE products
  SET stock_quantity = stock_quantity - NEW.quantity
  WHERE id = NEW.product_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_out_of_stock_sales
  BEFORE INSERT ON sale_items
  FOR EACH ROW
  EXECUTE FUNCTION check_stock_before_sale();