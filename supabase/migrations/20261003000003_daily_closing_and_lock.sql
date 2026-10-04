/*
  # Cash counts, daily closing and closed-day lock

  1. cash_counts (new table)
    - What the manager physically received per payment method. Insert-only (a recount is a new row;
      the latest row of the day is the one that counts). Expected amounts are NOT stored — they are
      computed by get_daily_cash_summary().

  2. get_daily_cash_summary(p_date, p_tz)        -> JSONB  (expected vs received, computed)
     get_daily_closing_checklist(p_date, p_tz)   -> JSONB  (computed checklist)
     close_day(p_date, p_tz)                      -> daily_closings row
    - close_day is the ONLY way to create a daily_closings row (no INSERT policy). It computes the
      snapshot server-side, allows closing with pending items (they are stored in `checklist`),
      and refuses a second closing for the same date.

  3. Closed-day lock (enforced in the database, not only in the UI)
    - BEFORE INSERT/UPDATE/DELETE trigger on every manager table. If the row belongs to a day that
      has a daily_closings row (timestamp inside [day_start, day_end)), it raises an exception.
    - Row day = its sale's created_at (sale-linked rows) or its own created_at.
    - created_at is forced to now() on insert so it cannot be backdated around the lock.
    - Single exception: a pending incident of a closed day can still be marked 'resuelta'
      (status change only; every other column must stay identical).
    - POS sales are NOT affected: sales/sale_items have no lock (the sale flow is untouched).
*/

-- 1. Cash counts
CREATE TABLE IF NOT EXISTS cash_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash DECIMAL(10,2) NOT NULL CHECK (cash >= 0),
  card DECIMAL(10,2) NOT NULL CHECK (card >= 0),
  other DECIMAL(10,2) NOT NULL CHECK (other >= 0),
  abonos DECIMAL(10,2) NOT NULL CHECK (abonos >= 0),
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cash_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and manager can view cash_counts" ON cash_counts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager')));

CREATE POLICY "Manager can insert cash_counts" ON cash_counts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager'));

-- 2a. Cash summary: expected (from POS data) vs latest count of the day
--     other  = sales.payment_method 'other', a generic/miscellaneous bucket — NOT transfers.
--              Confirmed with owner 2026-10-03: real data has 0 'other' rows (4380 cash, 2747
--              card); transfers are recorded under 'card' in this business, not 'other'.
--     abonos = shipments.advance_paid of shipments without sale_id created that day
--     devoluciones = total of sales with payment_status 'refunded' (partial refund amounts don't exist)
CREATE OR REPLACE FUNCTION get_daily_cash_summary(p_date DATE, p_tz TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT (p_date::timestamp AT TIME ZONE p_tz) AS day_start,
           ((p_date + 1)::timestamp AT TIME ZONE p_tz) AS day_end
  ),
  expected AS (
    SELECT COUNT(*) AS sales_count,
           COALESCE(SUM(s.total) FILTER (WHERE s.payment_status = 'completed'), 0) AS sales_total,
           COALESCE(SUM(s.total) FILTER (WHERE s.payment_status = 'completed' AND s.payment_method = 'cash'), 0) AS cash,
           COALESCE(SUM(s.total) FILTER (WHERE s.payment_status = 'completed' AND s.payment_method = 'card'), 0) AS card,
           COALESCE(SUM(s.total) FILTER (WHERE s.payment_status = 'completed' AND s.payment_method = 'other'), 0) AS other,
           COALESCE(SUM(s.total) FILTER (WHERE s.payment_status = 'refunded'), 0) AS devoluciones,
           COALESCE(SUM(s.discount), 0) AS descuentos
    FROM sales s
    CROSS JOIN bounds b
    WHERE s.created_at >= b.day_start AND s.created_at < b.day_end
  ),
  advances AS (
    SELECT COALESCE(SUM(sh.advance_paid), 0) AS abonos
    FROM shipments sh
    CROSS JOIN bounds b
    WHERE sh.sale_id IS NULL AND sh.created_at >= b.day_start AND sh.created_at < b.day_end
  ),
  latest_count AS (
    SELECT c.*
    FROM cash_counts c
    CROSS JOIN bounds b
    WHERE c.created_at >= b.day_start AND c.created_at < b.day_end
    ORDER BY c.created_at DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'sales_count', e.sales_count,
    'sales_total', e.sales_total,
    'devoluciones', e.devoluciones,
    'descuentos', e.descuentos,
    'expected', jsonb_build_object('cash', e.cash, 'card', e.card, 'other', e.other, 'abonos', a.abonos),
    'received', CASE WHEN lc.id IS NULL THEN NULL ELSE jsonb_build_object(
      'cash', lc.cash, 'card', lc.card, 'other', lc.other, 'abonos', lc.abonos, 'counted_at', lc.created_at) END,
    'difference', CASE WHEN lc.id IS NULL THEN NULL ELSE jsonb_build_object(
      'cash', lc.cash - e.cash, 'card', lc.card - e.card, 'other', lc.other - e.other, 'abonos', lc.abonos - a.abonos) END
  )
  FROM expected e
  CROSS JOIN advances a
  LEFT JOIN latest_count lc ON true
  WHERE EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager'));
$$;

-- 2b. Closing checklist (computed; nothing stored until close_day)
CREATE OR REPLACE FUNCTION get_daily_closing_checklist(p_date DATE, p_tz TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT (p_date::timestamp AT TIME ZONE p_tz) AS day_start,
           ((p_date + 1)::timestamp AT TIME ZONE p_tz) AS day_end
  ),
  day_sales AS (
    SELECT s.id
    FROM sales s
    CROSS JOIN bounds b
    WHERE s.created_at >= b.day_start AND s.created_at < b.day_end
  ),
  unverified AS (
    SELECT COUNT(*) AS n
    FROM day_sales ds
    LEFT JOIN sale_verifications v ON v.sale_id = ds.id
    WHERE v.status IS NULL OR v.status = 'pendiente'
  ),
  unfulfilled AS (
    SELECT COUNT(*) AS n
    FROM day_sales ds
    WHERE EXISTS (
      SELECT 1 FROM sale_items si
      WHERE si.sale_id = ds.id
        AND NOT EXISTS (
          SELECT 1 FROM sale_fulfillment_items fi
          JOIN sale_fulfillments f ON f.id = fi.fulfillment_id
          WHERE f.sale_id = ds.id AND fi.sale_item_id = si.id
        )
    )
  ),
  missing_staff AS (
    SELECT COUNT(*) AS n
    FROM day_sales ds
    JOIN sale_fulfillments f ON f.sale_id = ds.id
    WHERE f.picked_by IS NULL OR f.delivered_by IS NULL OR f.loaded_by IS NULL
  ),
  unjustified AS (
    SELECT COUNT(*) AS n FROM get_daily_inventory_report(p_date, p_tz) r WHERE r.sin_justificar <> 0
  ),
  open_incidents AS (
    SELECT COUNT(*) AS n
    FROM incidents i
    CROSS JOIN bounds b
    WHERE i.status = 'pendiente' AND i.created_at >= b.day_start AND i.created_at < b.day_end
  ),
  cash AS (
    -- Reconciled = a count exists and either matches, or a 'diferencia_caja' incident explains it
    SELECT (x.s -> 'received') IS NOT NULL AND (
             (   (x.s -> 'difference' ->> 'cash')::numeric = 0
             AND (x.s -> 'difference' ->> 'card')::numeric = 0
             AND (x.s -> 'difference' ->> 'other')::numeric = 0
             AND (x.s -> 'difference' ->> 'abonos')::numeric = 0)
             OR EXISTS (
               SELECT 1 FROM incidents i CROSS JOIN bounds b
               WHERE i.type = 'diferencia_caja'
                 AND i.created_at >= (x.s -> 'received' ->> 'counted_at')::timestamptz
                 AND i.created_at < b.day_end
             )
           ) AS ok
    FROM (SELECT get_daily_cash_summary(p_date, p_tz) AS s) x
  )
  SELECT jsonb_build_object(
    'ventas_revisadas',       jsonb_build_object('ok', unverified.n = 0,     'pendientes', unverified.n),
    'dinero_conciliado',      jsonb_build_object('ok', COALESCE(cash.ok, false)),
    'material_revisado',      jsonb_build_object('ok', unfulfilled.n = 0,    'pendientes', unfulfilled.n),
    'personal_registrado',    jsonb_build_object('ok', missing_staff.n = 0,  'pendientes', missing_staff.n),
    'diferencias_pendientes', jsonb_build_object('ok', unjustified.n = 0,    'pendientes', unjustified.n),
    'incidencias_pendientes', jsonb_build_object('ok', open_incidents.n = 0, 'pendientes', open_incidents.n)
  )
  FROM unverified, unfulfilled, missing_staff, unjustified, open_incidents, cash
  WHERE EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager'));
$$;

-- 2c. Close the day (only path to create a daily_closings row)
CREATE OR REPLACE FUNCTION close_day(p_date DATE, p_tz TEXT)
RETURNS daily_closings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ := p_date::timestamp AT TIME ZONE p_tz;
  v_end TIMESTAMPTZ := (p_date + 1)::timestamp AT TIME ZONE p_tz;
  v_row daily_closings;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'manager') THEN
    RAISE EXCEPTION 'Solo el gerente puede cerrar el día' USING ERRCODE = '42501';
  END IF;
  IF p_date > (now() AT TIME ZONE p_tz)::date THEN
    RAISE EXCEPTION 'No se puede cerrar una fecha futura (%)', p_date USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM daily_closings WHERE closing_date = p_date) THEN
    RAISE EXCEPTION 'El día % ya está cerrado', p_date USING ERRCODE = '23505';
  END IF;

  INSERT INTO daily_closings (closing_date, day_start, day_end, manager_id, totals, discrepancies, incidents, checklist)
  VALUES (
    p_date, v_start, v_end, auth.uid(),
    get_daily_cash_summary(p_date, p_tz),
    (SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM get_daily_inventory_report(p_date, p_tz) r),
    (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.created_at), '[]'::jsonb)
       FROM incidents i WHERE i.created_at >= v_start AND i.created_at < v_end),
    get_daily_closing_checklist(p_date, p_tz)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 3. Closed-day lock
CREATE OR REPLACE FUNCTION manager_row_day_ts(p_table TEXT, p_row JSONB)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_table IN ('sale_verifications', 'sale_adjustments', 'sale_fulfillments')
     OR (p_table = 'inventory_discrepancies' AND p_row ->> 'sale_id' IS NOT NULL) THEN
    RETURN (SELECT created_at FROM sales WHERE id = (p_row ->> 'sale_id')::uuid);
  ELSIF p_table = 'sale_fulfillment_items' THEN
    RETURN (SELECT s.created_at FROM sale_fulfillments f JOIN sales s ON s.id = f.sale_id
            WHERE f.id = (p_row ->> 'fulfillment_id')::uuid);
  ELSE
    RETURN (p_row ->> 'created_at')::timestamptz;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_open_day()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND TG_TABLE_NAME IN
     ('sale_adjustments', 'sale_fulfillments', 'inventory_discrepancies', 'incidents', 'cash_counts') THEN
    NEW.created_at := now();
  END IF;

  -- Only exception on a closed day: resolving a pending incident (status change only)
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'incidents'
     AND OLD.status = 'pendiente' AND NEW.status = 'resuelta'
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM daily_closings dc, LATERAL (SELECT manager_row_day_ts(TG_TABLE_NAME, to_jsonb(OLD)) AS ts) t
    WHERE t.ts >= dc.day_start AND t.ts < dc.day_end
  ) THEN
    RAISE EXCEPTION 'Día cerrado: % es de solo lectura para esa fecha', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM daily_closings dc, LATERAL (SELECT manager_row_day_ts(TG_TABLE_NAME, to_jsonb(NEW)) AS ts) t
    WHERE t.ts >= dc.day_start AND t.ts < dc.day_end
  ) THEN
    RAISE EXCEPTION 'Día cerrado: % es de solo lectura para esa fecha', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_open_day ON sale_verifications;
CREATE TRIGGER enforce_open_day BEFORE INSERT OR UPDATE OR DELETE ON sale_verifications
  FOR EACH ROW EXECUTE FUNCTION enforce_open_day();

DROP TRIGGER IF EXISTS enforce_open_day ON sale_adjustments;
CREATE TRIGGER enforce_open_day BEFORE INSERT OR UPDATE OR DELETE ON sale_adjustments
  FOR EACH ROW EXECUTE FUNCTION enforce_open_day();

DROP TRIGGER IF EXISTS enforce_open_day ON sale_fulfillments;
CREATE TRIGGER enforce_open_day BEFORE INSERT OR UPDATE OR DELETE ON sale_fulfillments
  FOR EACH ROW EXECUTE FUNCTION enforce_open_day();

DROP TRIGGER IF EXISTS enforce_open_day ON sale_fulfillment_items;
CREATE TRIGGER enforce_open_day BEFORE INSERT OR UPDATE OR DELETE ON sale_fulfillment_items
  FOR EACH ROW EXECUTE FUNCTION enforce_open_day();

DROP TRIGGER IF EXISTS enforce_open_day ON inventory_discrepancies;
CREATE TRIGGER enforce_open_day BEFORE INSERT OR UPDATE OR DELETE ON inventory_discrepancies
  FOR EACH ROW EXECUTE FUNCTION enforce_open_day();

DROP TRIGGER IF EXISTS enforce_open_day ON incidents;
CREATE TRIGGER enforce_open_day BEFORE INSERT OR UPDATE OR DELETE ON incidents
  FOR EACH ROW EXECUTE FUNCTION enforce_open_day();

DROP TRIGGER IF EXISTS enforce_open_day ON cash_counts;
CREATE TRIGGER enforce_open_day BEFORE INSERT OR UPDATE OR DELETE ON cash_counts
  FOR EACH ROW EXECUTE FUNCTION enforce_open_day();
