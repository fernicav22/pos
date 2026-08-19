/*
  # Fix Shipments RLS policies (JWT role claim isn't populated in this project)

  1. Problem
    - 20260819000001_create_shipments.sql used `auth.jwt() ->> 'role' IN (...)`,
      mirroring the pattern from 20251219000001_optimize_auth_performance.sql /
      20260218000001_add_cash_management.sql / 20260219000001_admin_view_all_staff.sql.
    - This project has no custom Auth Hook / trigger that embeds the app role
      into the JWT (confirmed: no such function exists in any migration), so
      `auth.jwt() ->> 'role'` never matches 'admin'/'manager'/'cashier'.
      Result: every insert/update on `shipments` / `shipment_items` and every
      read/write on the `delivery-proofs` storage bucket was rejected with
      "new row violates row-level security policy".

  2. Solution
    - Replace all shipments/shipment_items/storage.objects policies with the
      EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND role IN (...))
      pattern - the same one `purchases`/`suppliers` already use successfully
      in 20250411065250_aged_lodge.sql.
*/

-- Shipments policies
DROP POLICY IF EXISTS "Staff can view shipments" ON shipments;
CREATE POLICY "Staff can view shipments" ON shipments
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  );

DROP POLICY IF EXISTS "Staff can create shipments" ON shipments;
CREATE POLICY "Staff can create shipments" ON shipments
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  );

DROP POLICY IF EXISTS "Staff can update shipments" ON shipments;
CREATE POLICY "Staff can update shipments" ON shipments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  );

-- Shipment items policies
DROP POLICY IF EXISTS "Staff can view shipment items" ON shipment_items;
CREATE POLICY "Staff can view shipment items" ON shipment_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  );

DROP POLICY IF EXISTS "Staff can create shipment items" ON shipment_items;
CREATE POLICY "Staff can create shipment items" ON shipment_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
    AND EXISTS (SELECT 1 FROM shipments WHERE shipments.id = shipment_id)
  );

DROP POLICY IF EXISTS "Staff can update shipment items" ON shipment_items;
CREATE POLICY "Staff can update shipment items" ON shipment_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  );

DROP POLICY IF EXISTS "Staff can delete shipment items" ON shipment_items;
CREATE POLICY "Staff can delete shipment items" ON shipment_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  );

-- Delivery proof storage policies
DROP POLICY IF EXISTS "Staff can view delivery proofs" ON storage.objects;
CREATE POLICY "Staff can view delivery proofs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'delivery-proofs'
    AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  );

DROP POLICY IF EXISTS "Staff can upload delivery proofs" ON storage.objects;
CREATE POLICY "Staff can upload delivery proofs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-proofs'
    AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  );

DROP POLICY IF EXISTS "Staff can update delivery proofs" ON storage.objects;
CREATE POLICY "Staff can update delivery proofs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'delivery-proofs'
    AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  );

DROP POLICY IF EXISTS "Staff can delete delivery proofs" ON storage.objects;
CREATE POLICY "Staff can delete delivery proofs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'delivery-proofs'
    AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager', 'cashier'))
  );
