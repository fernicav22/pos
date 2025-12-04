/*
  # Add user to users table
  
  1. Changes
    - Insert new user into users table
    - User will be linked to existing auth.users entry
  
  2. Security
    - Uses existing RLS policies
    - No security changes needed
*/

DO $$ 
BEGIN
  INSERT INTO users (id, email, first_name, last_name, role)
  SELECT 
    id,
    email,
    'Admin', -- admin
    'User',  -- fer
    'admin'  -- Role: 'admin', 'manager', or 'cashier'
  FROM auth.users
  WHERE email = 'admin@adomi.com' -- Replace with your actual email
  ON CONFLICT (id) DO NOTHING;
END $$;