/*
  # Fix enforce_open_day() crashing on every table except incidents

  Found live on 2026-10-03 while re-testing Phase A: the resolve-only bypass
  referenced OLD.status / NEW.status directly. PL/pgSQL resolves that field
  access against the actual firing table's row type, and every table this
  trigger is attached to EXCEPT incidents has no status column -- so any
  insert/update/delete on sale_verifications, sale_adjustments,
  sale_fulfillments, sale_fulfillment_items, inventory_discrepancies, or
  cash_counts raised "record \"old\"/\"new\" has no field \"status\""
  (42703), regardless of whether any day was even closed yet. Only incidents
  itself worked. Confirmed by a real (rolled back) test run against
  production, see chat history for the exact error and repro.

  Fix: use to_jsonb(OLD)->>'status' / to_jsonb(NEW)->>'status' instead of
  direct field access. to_jsonb() works generically on any row type, and ->>
  returns NULL instead of erroring when the key is absent -- so the bypass
  condition still only ever matches on incidents (NULL = 'pendiente' is
  false for every other table), with identical behavior there. No other
  logic changes.
*/

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
