/*
  # Add Shipments / Logistics Module

  1. New Tables
    - `shipments`
      - Tracks a delivery from creation to drop-off.
      - `type` distinguishes local (from existing stock) vs sobre_pedido
        (material must be purchased first via the existing Purchases module).
      - Optionally references an existing `sales` row (venta_relacionada) and,
        for sobre_pedido shipments, an existing `purchases` row once material
        sourcing starts.
      - `status` models the full flow: pendiente -> (comprando_material, sobre_pedido
        only) -> preparando_pedido -> en_ruta -> entregado, with `cancelado`
        reachable from any non-terminal status.
    - `shipment_items`
      - Line items referencing existing `products` (no product data is
        duplicated), snapshotting `unit_price` at creation time the same way
        `sale_items.price` / `purchase_items.cost_per_unit` do.

  2. Security
    - RLS enabled on both tables.
    - Only staff roles (admin, manager, cashier) can view/create/update -
      customer role has no access, matching Transactions/Purchases.
    - No DELETE policy on `shipments` (cancellation via status is the only
      removal path, same convention as purchases).

  3. Storage
    - Private `delivery-proofs` bucket for the optional delivery evidence
      photo. Only staff roles can read/write objects in it.
    - No server-side TTL exists for this bocket; expired (>15 day) photos are
      pruned opportunistically from the client when the Shipments page loads
      (see src/pages/Shipments.tsx: cleanupExpiredDeliveryProofs).
*/

-- Shipments table
CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  courier_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('local', 'sobre_pedido')),
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (
    status IN ('pendiente', 'comprando_material', 'preparando_pedido', 'en_ruta', 'entregado', 'cancelado')
  ),
  -- comprando_material only makes sense while sourcing material for a sobre_pedido shipment
  CONSTRAINT shipments_comprando_material_requires_sobre_pedido CHECK (
    status != 'comprando_material' OR type = 'sobre_pedido'
  ),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgente')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  address TEXT NOT NULL,
  address_reference TEXT,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  total DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  advance_paid DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (advance_paid >= 0),
  recipient_name TEXT,
  delivery_notes TEXT,
  delivery_photo_path TEXT,
  delivery_photo_uploaded_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shipment items table
CREATE TABLE IF NOT EXISTS shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_type ON shipments(type);
CREATE INDEX IF NOT EXISTS idx_shipments_sale_id ON shipments(sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_purchase_id ON shipments(purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_courier_id ON shipments(courier_id) WHERE courier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_priority ON shipments(priority);
CREATE INDEX IF NOT EXISTS idx_shipments_photo_cleanup ON shipments(delivery_photo_uploaded_at) WHERE delivery_photo_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment_id ON shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_product_id ON shipment_items(product_id);

-- Auto-update updated_at (reuses the existing optimized trigger function)
DROP TRIGGER IF EXISTS update_shipments_updated_at ON shipments;
CREATE TRIGGER update_shipments_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_optimized();

-- Enable Row Level Security
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_items ENABLE ROW LEVEL SECURITY;

-- Shipments policies (staff only: admin, manager, cashier - no customer access)
CREATE POLICY "Staff can view shipments" ON shipments
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier'));

CREATE POLICY "Staff can create shipments" ON shipments
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier')
    AND created_by = auth.uid()
  );

CREATE POLICY "Staff can update shipments" ON shipments
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier'));

-- Shipment items policies
CREATE POLICY "Staff can view shipment items" ON shipment_items
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier'));

CREATE POLICY "Staff can create shipment items" ON shipment_items
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier')
    AND EXISTS (SELECT 1 FROM shipments WHERE shipments.id = shipment_id)
  );

CREATE POLICY "Staff can update shipment items" ON shipment_items
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier'));

CREATE POLICY "Staff can delete shipment items" ON shipment_items
  FOR DELETE TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier'));

-- Private storage bucket for optional delivery evidence photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-proofs', 'delivery-proofs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Staff can view delivery proofs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'delivery-proofs' AND auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier'));

CREATE POLICY "Staff can upload delivery proofs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'delivery-proofs' AND auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier'));

CREATE POLICY "Staff can update delivery proofs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'delivery-proofs' AND auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier'));

CREATE POLICY "Staff can delete delivery proofs" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'delivery-proofs' AND auth.jwt() ->> 'role' IN ('admin', 'manager', 'cashier'));
