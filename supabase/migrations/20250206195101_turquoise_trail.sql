-- Create a function to update product stock
CREATE OR REPLACE FUNCTION update_product_stock(p_product_id UUID, p_quantity INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE products
  SET 
    stock_quantity = stock_quantity - p_quantity,
    updated_at = NOW()
  WHERE id = p_product_id;
END;
$$ LANGUAGE plpgsql;