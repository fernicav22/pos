# Manager Dashboard — Reconocimiento (solo lectura)

Stack real: **React 18 + Vite + react-router** (no Next.js) + Supabase. Roles: `admin` (dueño), `manager` (gerente), `cashier`, `customer`.

## Mapa de tablas (nombre real → columnas clave)
| Concepto | Tabla | Columnas clave |
|---|---|---|
| Notas/ventas | `sales` | id, user_id, customer_id, subtotal, tax, discount, total, payment_method, payment_status, cash_tendered, change_given, notes, created_at |
| Detalle de nota | `sale_items` | id, sale_id, product_id, variant_id, quantity, price, subtotal, discount, created_at |
| Productos | `products` | id, name, sku, barcode, category_id, price, cost, stock_quantity, low_stock_alert, active, attributes |
| Variantes | `product_variants` | id, product_id, sku, price, stock_quantity, active |
| Categorías | `categories` | id, name, parent_id |
| Inventario (entradas) | `purchases` / `purchase_items` | supplier_id, user_id, status (draft/ordered/received/cancelled), payment_status (pending/partial/paid), total · product_id, quantity, cost_per_unit, received_quantity |
| Proveedores | `suppliers` | id, name, active |
| Pagos | (sin tabla) | `sales.payment_method` ∈ cash/card/other; `sales.payment_status` ∈ completed/failed/pending/refunded/partially_refunded |
| Caja | `users.cash_on_hand` + `cash_adjustments` | user_id, admin_id, old_amount, new_amount, reason, created_at |
| Usuarios/roles | `users` | id (=auth.users.id), email, first_name, last_name, role, active, cash_on_hand |
| Clientes | `customers` | id, first_name, last_name, phone, loyalty_points, total_purchases, segment |
| Pedidos borrador | `draft_orders` | user_id, customer_id, items (JSONB), subtotal, tax, shipping, total |
| Envíos | `shipments` / `shipment_items` | sale_id, purchase_id, status, type, total, advance_paid · product_id, quantity, unit_price |
| Caché/estadísticas | `daily_stats_cache`, `query_cache`, `sales_partitioned` | existen en migraciones; ninguna se usa desde `src/` |

## Movimientos de stock (sin tabla de movimientos)
- Venta: trigger `check_stock_before_sale` (BEFORE INSERT en `sale_items`) valida stock y lo descuenta de `products`/`product_variants`.
- Compra: trigger `trigger_update_stock_on_purchase_receive` suma `received_quantity` cuando `purchases.status` pasa a `received`.
- Ajuste manual: el admin edita `products.stock_quantity` directamente desde Products.tsx, sin bitácora.
- RPCs relacionadas: `update_product_stock`, `batch_update_product_stock`, `create_sale_with_items`, `complete_cash_sale`.

## Mecanismo de roles
- No hay middleware de servidor. El rol se lee de `users.role` en `authStore.ts` (`fetchAndSetUser`).
- Frontend: matriz `rolePermissions` + `hasPermission()` en `src/utils/permissions.ts`; el guard de rutas es `<ProtectedRoute permission=...>`; el menú está en `Sidebar.tsx` (arreglo `role: [...]` por ítem).
- Manager hoy: POS, Customers, Purchases, Reports, Transactions (solo el día actual), Shipments. Sin Products, Staff ni Settings.
- RLS: el patrón válido es `EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN (...))`. `sales` y `sale_items` permiten que admin y manager vean todo y que el cashier vea solo lo suyo (`20251204000013`).
- Las políticas con `auth.jwt() ->> 'role'` (products/categories y cash_adjustments) **no funcionan**: no existe un Auth Hook que agregue el rol al JWT.

## Rutas relevantes (`src/App.tsx`)
`/dashboard` (sin ProtectedRoute; el bloqueo de rol está dentro de Dashboard.tsx), `/pos`, `/transactions`, `/reports`, `/purchases`, `/shipments`, `/customers`, `/products`, `/staff`, `/settings`, `/login`.

## Qué existe hoy
- **Descuentos:** existen las columnas `sales.discount` y `sale_items.discount`, y los RPC las aceptan. No hay UI en POS ni en Transactions que las capture.
- **Devoluciones:** solo están los estados `refunded`/`partially_refunded` y el filtro en Transactions. No hay flujo, tabla de devoluciones ni reingreso de stock.
- **Abonos:** `purchases.payment_status = 'partial'` (sin monto ni historial) y `shipments.advance_paid` (un solo monto). No hay abonos sobre `sales`.
- **Entradas de inventario:** solo las compras recibidas (trigger). No hay entrada manual registrada.

## Huecos detectados
1. No hay bitácora de movimientos de inventario: no se puede auditar quién movió stock, cuándo ni por qué.
2. No hay tabla de pagos: una nota solo puede tener una forma de pago, y no hay pagos mixtos ni abonos.
3. Las devoluciones son un estado sin flujo: no devuelven stock ni dinero a la caja.
4. Descuento: existe en la base de datos, pero no hay UI que lo capture, quién lo autorizó ni su motivo.
5. Las RLS basadas en JWT de products/categories/cash_adjustments son sospechosas (ver AGENTS.md).
6. `/dashboard`: el Sidebar se lo muestra al cashier, pero la página lo bloquea. La ruta no tiene ProtectedRoute.
7. El manager está limitado al día actual en Transactions, solo en el frontend; la RLS de `sales` no restringe por fecha.
8. `daily_stats_cache`/`get_dashboard_stats` existen, pero no se usan. Hay que verificar que estén en la base de datos real antes de apoyarse en ellos.
9. `FIX_STOCK_DEDUCTION.sql` (en la raíz, fuera de migraciones) redefine el trigger de stock. No se sabe si está aplicado.
