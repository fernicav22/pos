/*
  # Daily inventory reconciliation report + staff directory

  1. get_daily_inventory_report(p_date, p_tz)
    - Computed on the fly from existing data; nothing is stored.
    - Per product with activity on p_date (local day in p_tz):
        inicial          = products.stock_quantity - entradas since day start + vendido since day start
                           (back-calculated: there is no stock history table; manual stock
                            edits in Products.tsx after day start make this inexact)
        entradas         = purchase_items.received_quantity of purchases received on p_date
                           (purchases.delivery_date)
        devoluciones     = 0 (no returns flow exists yet)
        vendido_pos      = sale_items.quantity of sales created on p_date
        mermas           = inventory_discrepancies without sale_id, reason dano/merma
        salidas_internas = inventory_discrepancies without sale_id, reason muestra/uso_interno/salida_sin_nota
        esperado         = inicial + entradas + devoluciones - vendido_pos - mermas - salidas_internas
        surtido          = sale_fulfillment_items.quantity_fulfilled for sales of p_date
        diferencia       = vendido_pos - surtido
        justificado      = inventory_discrepancies with sale_id (sales of p_date)
        sin_justificar   = diferencia - justificado
    - SECURITY INVOKER: caller's RLS applies (admin/manager read all involved tables),
      plus an explicit admin/manager check so cashiers get no rows from their own sales.

  2. get_staff_directory()
    - users RLS only lets a manager read their own row ("Admins can view all users"
      relies on auth.jwt() ->> 'role', which never matches — see AGENTS.md).
    - Returns only id/name/role of active staff, only to admin/manager callers,
      instead of opening the users table (email, cash_on_hand) to managers.
*/

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
    SELECT (p_date::timestamp AT TIME ZONE p_tz) AS day_start,
           ((p_date + 1)::timestamp AT TIME ZONE p_tz) AS day_end
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

CREATE OR REPLACE FUNCTION get_staff_directory()
RETURNS TABLE (id UUID, first_name TEXT, last_name TEXT, role TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.first_name, u.last_name, u.role
  FROM users u
  WHERE u.active = true
    AND u.role IN ('admin', 'manager', 'cashier')
    AND EXISTS (SELECT 1 FROM users me WHERE me.id = auth.uid() AND me.role IN ('admin', 'manager'))
  ORDER BY u.first_name, u.last_name;
$$;
