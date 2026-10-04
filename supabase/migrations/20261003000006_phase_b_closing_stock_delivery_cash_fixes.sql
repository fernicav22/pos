/*
  # Phase B fixes: post-closing sales, stock trigger idempotency,
    delivery_date business timezone

  1. Post-closing sales (decision: POS keeps selling; a sale made after close_day
     belongs to the next closing; the closed day stays locked; owner gets an alert)

     a) Lock upper bound = LEAST(dc.closed_at, dc.day_end), not dc.closed_at alone.
        Closing a day late (closed_at falls on the following calendar day) must
        never lock rows that actually belong to the following day - capping at
        day_end keeps a late closing's lock from ever crossing midnight.

     b) get_effective_day_start(p_date, p_tz): a day's real start is the previous
        day's closed_at, but ONLY when that previous day was closed before its own
        day_end (i.e. closed on time / early). If the previous day was closed late,
        or was never closed, the previous day's lock already extended all the way
        to its own day_end (per (a)), so there is nothing left over to absorb and
        this day starts at its own calendar midnight as before.
        Applied in get_daily_inventory_report, get_daily_cash_summary,
        get_daily_closing_checklist (bounds CTE) and close_day (v_start, so the
        stored day_start - and therefore the lock - covers the absorbed sales once
        this day itself is closed).

     c) get_sales_after_closing(p_tz): new read-only helper (admin/manager only)
        listing sales whose created_at is on/after their own calendar day's
        closed_at. Backs the owner's /admin "venta después del cierre" alert
        (Phase C).

  2. Stock trigger idempotency (NO behavior change in production)
     - Production already has exactly one stock-deduction trigger
       (check_stock_before_sale -> check_stock_before_sale_optimized(), set up by
       20251206000003_optimize_postgrest_operations.sql after the untracked, already
       manually-applied FIX_STOCK_DEDUCTION.sql dropped the original
       prevent_out_of_stock_sales trigger out of band).
     - A from-scratch migration run never drops prevent_out_of_stock_sales, so it
       would end up with BOTH triggers firing on every sale_items insert (double
       deduction). This DROP TRIGGER IF EXISTS is a no-op against production (the
       trigger is already gone there) and only changes the from-scratch outcome.

  3. purchases.delivery_date stored in the business timezone
     - Purchases.tsx sets delivery_date client-side via `new Date().toISOString()`,
       a full UTC timestamp string. Casting that directly to a DATE column keeps the
       literal Y-M-D digits with no timezone conversion, so any purchase received
       locally from ~5-6pm onward (America/Ciudad_Juarez, UTC-6/-7) gets stored one
       calendar day ahead of the real local business date.
     - The app's own INSERT (Purchases.tsx handleSubmit) always sets status to
       'draft' or 'ordered', never 'received' - but nothing at the DB layer stops a
       direct INSERT with status='received' (the CHECK constraint allows it, and
       "Admin and managers can modify purchases" is FOR ALL with no status
       restriction), which would skip an UPDATE-only trigger entirely. The trigger
       below fires on INSERT OR UPDATE and checks TG_OP in the function body so it
       cannot reference OLD unsafely when there isn't one.
     - Overwrites NEW.delivery_date with
       (now() AT TIME ZONE 'America/Ciudad_Juarez')::date whenever a row is
       inserted already 'received', or transitions to 'received', regardless of
       what the client sends. Historical rows are NOT rewritten (checked
       separately, read-only).

  NOTE: the "Admins can update user cash" fix is intentionally NOT in this
  migration - removed per review. A separate read-only audit of every live
  auth.jwt() ->> 'role' policy is run instead, no fixes.
*/

-- ============================================================
-- 1b. Effective day start helper
-- ============================================================
CREATE OR REPLACE FUNCTION get_effective_day_start(p_date DATE, p_tz TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT dc.closed_at FROM daily_closings dc
     WHERE dc.closing_date = p_date - 1 AND dc.closed_at < dc.day_end),
    p_date::timestamp AT TIME ZONE p_tz
  );
$$;

-- ============================================================
-- 1b. get_daily_inventory_report - bounds now use the effective day start
-- ============================================================
CREATE OR REPLACE FUNCTION get_daily_inventory_report(p_date DATE, p_tz TEXT)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  sku TEXT,
  inicial BIGINT,
  entradas BIGINT,
  devoluciones BIGINT,
  vendido_pos BIGINT,
  mermas BIGINT,
  salidas_internas BIGINT,
  esperado BIGINT,
  surtido BIGINT,
  diferencia BIGINT,
  justificado BIGINT,
  sin_justificar BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT get_effective_day_start(p_date, p_tz) AS day_start,
           LEAST(
             (p_date + 1)::timestamp AT TIME ZONE p_tz,
             COALESCE((SELECT dc.closed_at FROM daily_closings dc WHERE dc.closing_date = p_date), (p_date + 1)::timestamp AT TIME ZONE p_tz)
           ) AS day_end
  ),
  sold AS (
    SELECT si.product_id,
           SUM(si.quantity) FILTER (WHERE s.created_at < b.day_end) AS day_qty,
           SUM(si.quantity) AS since_start_qty
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    CROSS JOIN bounds b
    WHERE s.created_at >= b.day_start
    GROUP BY si.product_id
  ),
  received AS (
    SELECT pi.product_id,
           SUM(pi.received_quantity) FILTER (WHERE p.delivery_date = p_date) AS day_qty,
           SUM(pi.received_quantity) AS since_start_qty
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    WHERE p.status = 'received' AND p.delivery_date >= p_date
    GROUP BY pi.product_id
  ),
  fulfilled AS (
    SELECT si.product_id, SUM(sfi.quantity_fulfilled) AS qty
    FROM sale_fulfillment_items sfi
    JOIN sale_items si ON si.id = sfi.sale_item_id
    JOIN sales s ON s.id = si.sale_id
    CROSS JOIN bounds b
    WHERE s.created_at >= b.day_start AND s.created_at < b.day_end
    GROUP BY si.product_id
  ),
  standalone AS (
    SELECT d.product_id,
           SUM(d.quantity) FILTER (WHERE d.reason IN ('dano', 'merma')) AS mermas,
           SUM(d.quantity) FILTER (WHERE d.reason IN ('muestra', 'uso_interno', 'salida_sin_nota')) AS salidas
    FROM inventory_discrepancies d
    CROSS JOIN bounds b
    WHERE d.sale_id IS NULL AND d.created_at >= b.day_start AND d.created_at < b.day_end
    GROUP BY d.product_id
  ),
  justified AS (
    SELECT d.product_id, SUM(d.quantity) AS qty
    FROM inventory_discrepancies d
    JOIN sales s ON s.id = d.sale_id
    CROSS JOIN bounds b
    WHERE s.created_at >= b.day_start AND s.created_at < b.day_end
    GROUP BY d.product_id
  ),
  active AS (
    SELECT sold.product_id FROM sold WHERE day_qty IS NOT NULL
    UNION SELECT received.product_id FROM received WHERE day_qty IS NOT NULL
    UNION SELECT standalone.product_id FROM standalone
    UNION SELECT justified.product_id FROM justified
  ),
  calc AS (
    SELECT pr.id,
           pr.name,
           pr.sku,
           pr.stock_quantity - COALESCE(r.since_start_qty, 0) + COALESCE(so.since_start_qty, 0) AS inicial,
           COALESCE(r.day_qty, 0) AS entradas,
           0::BIGINT AS devoluciones,
           COALESCE(so.day_qty, 0) AS vendido_pos,
           COALESCE(st.mermas, 0) AS mermas,
           COALESCE(st.salidas, 0) AS salidas_internas,
           COALESCE(f.qty, 0) AS surtido,
           COALESCE(j.qty, 0) AS justificado
    FROM active a
    JOIN products pr ON pr.id = a.product_id
    LEFT JOIN sold so ON so.product_id = a.product_id
    LEFT JOIN received r ON r.product_id = a.product_id
    LEFT JOIN fulfilled f ON f.product_id = a.product_id
    LEFT JOIN standalone st ON st.product_id = a.product_id
    LEFT JOIN justified j ON j.product_id = a.product_id
  )
  SELECT id, name, sku,
         inicial, entradas, devoluciones, vendido_pos, mermas, salidas_internas,
         inicial + entradas + devoluciones - vendido_pos - mermas - salidas_internas AS esperado,
         surtido,
         vendido_pos - surtido AS diferencia,
         justificado,
         vendido_pos - surtido - justificado AS sin_justificar
  FROM calc
  WHERE EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager'))
  ORDER BY (vendido_pos - surtido - justificado) <> 0 DESC, name;
$$;

-- ============================================================
-- 1b. get_daily_cash_summary - bounds now use the effective day start
-- ============================================================
CREATE OR REPLACE FUNCTION get_daily_cash_summary(p_date DATE, p_tz TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT get_effective_day_start(p_date, p_tz) AS day_start,
           LEAST(
             (p_date + 1)::timestamp AT TIME ZONE p_tz,
             COALESCE((SELECT dc.closed_at FROM daily_closings dc WHERE dc.closing_date = p_date), (p_date + 1)::timestamp AT TIME ZONE p_tz)
           ) AS day_end
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

-- ============================================================
-- 1b. get_daily_closing_checklist - bounds now use the effective day start
-- ============================================================
CREATE OR REPLACE FUNCTION get_daily_closing_checklist(p_date DATE, p_tz TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT get_effective_day_start(p_date, p_tz) AS day_start,
           LEAST(
             (p_date + 1)::timestamp AT TIME ZONE p_tz,
             COALESCE((SELECT dc.closed_at FROM daily_closings dc WHERE dc.closing_date = p_date), (p_date + 1)::timestamp AT TIME ZONE p_tz)
           ) AS day_end
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

-- ============================================================
-- 1b. close_day - v_start now the effective day start, stored as day_start
-- ============================================================
CREATE OR REPLACE FUNCTION close_day(p_date DATE, p_tz TEXT)
RETURNS daily_closings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ := get_effective_day_start(p_date, p_tz);
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

-- ============================================================
-- 1a. Lock trigger: upper bound capped at day_end, never crosses midnight
-- ============================================================
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
     AND (to_jsonb(OLD)->>'status') = 'pendiente' AND (to_jsonb(NEW)->>'status') = 'resuelta'
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM daily_closings dc, LATERAL (SELECT manager_row_day_ts(TG_TABLE_NAME, to_jsonb(OLD)) AS ts) t
    WHERE t.ts >= dc.day_start AND t.ts < LEAST(dc.closed_at, dc.day_end)
  ) THEN
    RAISE EXCEPTION 'Día cerrado: % es de solo lectura para esa fecha', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM daily_closings dc, LATERAL (SELECT manager_row_day_ts(TG_TABLE_NAME, to_jsonb(NEW)) AS ts) t
    WHERE t.ts >= dc.day_start AND t.ts < LEAST(dc.closed_at, dc.day_end)
  ) THEN
    RAISE EXCEPTION 'Día cerrado: % es de solo lectura para esa fecha', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 1c. Owner alert helper: sales on/after their day's closed_at
-- ============================================================
CREATE OR REPLACE FUNCTION get_sales_after_closing(p_tz TEXT)
RETURNS TABLE (sale_id UUID, sale_created_at TIMESTAMPTZ, closing_date DATE, closed_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT s.id, s.created_at, dc.closing_date, dc.closed_at
  FROM sales s
  JOIN daily_closings dc ON dc.closing_date = (s.created_at AT TIME ZONE p_tz)::date
  WHERE s.created_at >= dc.closed_at
    AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'manager'))
  ORDER BY s.created_at DESC;
$$;

-- ============================================================
-- 2. Stock trigger idempotency (no behavior change in production)
-- ============================================================
DROP TRIGGER IF EXISTS prevent_out_of_stock_sales ON sale_items;

-- ============================================================
-- 3. purchases.delivery_date stored in business timezone (covers INSERT too)
-- ============================================================
CREATE OR REPLACE FUNCTION set_delivery_date_business_tz()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'received' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'received') THEN
    NEW.delivery_date := (now() AT TIME ZONE 'America/Ciudad_Juarez')::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_delivery_date_business_tz ON purchases;
CREATE TRIGGER set_delivery_date_business_tz
  BEFORE INSERT OR UPDATE ON purchases
  FOR EACH ROW
  EXECUTE FUNCTION set_delivery_date_business_tz();
