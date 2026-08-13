/*
  # Drop mis-attached purchase_items stock trigger (variant_id bug)

  Root cause of: 42703 "record ""new"" has no field ""variant_id""
  raised on every INSERT into purchase_items (i.e. every "New Purchase
  Order" submit in src/pages/Purchases.tsx handleSubmit).

  FIX_STOCK_DEDUCTION.sql (repo root, an ad-hoc script, never applied as
  a tracked migration) created:

    CREATE TRIGGER increase_stock_on_purchase
      AFTER INSERT ON purchase_items
      FOR EACH ROW
      EXECUTE FUNCTION increase_stock_on_purchase();

  The function body was copied from the sale_items variant-aware stock
  logic (see check_stock_before_sale() in 20251203000000_fix_missing_fields.sql)
  and references NEW.variant_id. purchase_items has never had a
  variant_id column — see the table definition in
  20250411065250_aged_lodge.sql and every later
  `ALTER TABLE purchase_items` statement (20251204000010, none add
  variant_id). This project has no concept of purchase-order-level
  variants anywhere in the schema.

  This trigger is distinct from, and not a duplicate of, the legitimate
  trigger_update_stock_on_purchase_receive / update_stock_on_purchase_receive()
  (also in 20250411065250_aged_lodge.sql), which fires on UPDATE of
  purchases.status -> 'received', reads purchase_items.received_quantity,
  and never references variant_id. That trigger is correct and is left
  untouched by this migration.

  Fix: drop only the mis-attached trigger. The orphaned function
  increase_stock_on_purchase() is intentionally left in place (unused,
  not dropped) since removing functions is out of scope for this fix.
*/

DROP TRIGGER IF EXISTS increase_stock_on_purchase ON purchase_items;
