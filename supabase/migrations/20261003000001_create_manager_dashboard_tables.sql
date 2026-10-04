/*
  # Manager Dashboard tables

  1. New Tables (reuse sales, sale_items, products, users — no duplicated data)
    - sale_verifications        one row per sale: pendiente / verificada / ajustada
    - sale_adjustments          immutable audit log of field changes on a sale
    - sale_fulfillments         one row per sale: who picked / delivered / loaded
    - sale_fulfillment_items    quantity fulfilled per sale_item
    - inventory_discrepancies   stock differences with reason
    - incidents                 free-form incidents, optional sale/product/person
    - daily_closings            immutable daily snapshot, one per date

  2. Security
    - manager: read/write (sale_adjustments: insert only; daily_closings: only via close_day())
    - admin: read only
    - cashier/customer: no access (no policy matches)
    - Uses EXISTS (SELECT 1 FROM users ...) — NOT auth.jwt() ->> 'role' (see AGENTS.md)
*/

-- 1. Sale verification
CREATE TABLE IF NOT EXISTS sale_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL UNIQUE REFERENCES sales(id),
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'verificada', 'ajustada')),
  user_id UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_sale_verifications_updated_at ON sale_verifications;
CREATE TRIGGER update_sale_verifications_updated_at
  BEFORE UPDATE ON sale_verifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_optimized();

-- 2. Sale adjustments (immutable)
CREATE TABLE IF NOT EXISTS sale_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id),
  field TEXT NOT NULL,
  original_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Fulfillment (surtido)
CREATE TABLE IF NOT EXISTS sale_fulfillments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL UNIQUE REFERENCES sales(id),
  picked_by UUID REFERENCES users(id),
  delivered_by UUID REFERENCES users(id),
  loaded_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_fulfillment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id UUID NOT NULL REFERENCES sale_fulfillments(id) ON DELETE CASCADE,
  sale_item_id UUID NOT NULL REFERENCES sale_items(id),
  quantity_fulfilled INTEGER NOT NULL CHECK (quantity_fulfilled >= 0),
  UNIQUE (fulfillment_id, sale_item_id)
);

-- 4. Inventory discrepancies
--    quantity is signed: positive = units out / sold but not fulfilled, negative = surplus.
--    With sale_id: justifies a fulfillment gap on that sale (does not count as a stock exit).
--    Without sale_id: standalone exit (merma, uso interno...) counted in the daily report.
CREATE TABLE IF NOT EXISTS inventory_discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity <> 0),
  reason TEXT NOT NULL CHECK (reason IN (
    'dano', 'merma', 'muestra', 'uso_interno', 'salida_sin_nota', 'error_captura', 'otro'
  )),
  notes TEXT,
  sale_id UUID REFERENCES sales(id),
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Incidents
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN (
    'material_danado', 'faltante', 'cliente_inconforme', 'diferencia_caja',
    'descuento_especial', 'entrega_incorrecta', 'salida_sin_nota', 'otro'
  )),
  description TEXT NOT NULL,
  sale_id UUID REFERENCES sales(id),
  product_id UUID REFERENCES products(id),
  person_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'resuelta')),
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Daily closings (immutable snapshot, written only by close_day() in 20261003000003)
--    day_start/day_end: exact range the closing covers (no store timezone exists);
--    the closed-day lock compares row timestamps against this range.
CREATE TABLE IF NOT EXISTS daily_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_date DATE NOT NULL UNIQUE,
  day_start TIMESTAMPTZ NOT NULL,
  day_end TIMESTAMPTZ NOT NULL,
  manager_id UUID NOT NULL REFERENCES users(id),
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  totals JSONB NOT NULL,
  discrepancies JSONB NOT NULL,
  incidents JSONB NOT NULL,
  checklist JSONB NOT NULL,
  CHECK (day_end > day_start)
);

-- RLS
ALTER TABLE sale_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_fulfillment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_closings ENABLE ROW LEVEL SECURITY;

-- SELECT: admin + manager on all seven tables
CREATE POLICY "Admin and manager can view sale_verifications" ON sale_verifications
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager')));

CREATE POLICY "Admin and manager can view sale_adjustments" ON sale_adjustments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager')));

CREATE POLICY "Admin and manager can view sale_fulfillments" ON sale_fulfillments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager')));

CREATE POLICY "Admin and manager can view sale_fulfillment_items" ON sale_fulfillment_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager')));

CREATE POLICY "Admin and manager can view inventory_discrepancies" ON inventory_discrepancies
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager')));

CREATE POLICY "Admin and manager can view incidents" ON incidents
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager')));

CREATE POLICY "Admin and manager can view daily_closings" ON daily_closings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager')));

-- INSERT: manager only, author must be the caller
CREATE POLICY "Manager can insert sale_verifications" ON sale_verifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can insert sale_adjustments" ON sale_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can insert sale_fulfillments" ON sale_fulfillments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can insert sale_fulfillment_items" ON sale_fulfillment_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can insert inventory_discrepancies" ON inventory_discrepancies
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can insert incidents" ON incidents
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

-- daily_closings: no INSERT policy — rows are created only by close_day() (SECURITY DEFINER),
-- so the snapshot is computed server-side and cannot be fabricated by the client.

-- UPDATE / DELETE: manager only, mutable tables only
-- (sale_adjustments and daily_closings get no UPDATE/DELETE policy => immutable under RLS)
CREATE POLICY "Manager can update sale_verifications" ON sale_verifications
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Manager can update sale_fulfillments" ON sale_fulfillments
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can delete sale_fulfillments" ON sale_fulfillments
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can update sale_fulfillment_items" ON sale_fulfillment_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can delete sale_fulfillment_items" ON sale_fulfillment_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can update inventory_discrepancies" ON inventory_discrepancies
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can delete inventory_discrepancies" ON inventory_discrepancies
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can update incidents" ON incidents
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

CREATE POLICY "Manager can delete incidents" ON incidents
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));
