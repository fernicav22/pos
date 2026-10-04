# Manager Dashboard

Stack: React 18 + Vite + react-router + Supabase. Roles: `admin` (dueño), `manager` (gerente), `cashier`, `customer`.
Zona horaria del negocio: `America/Ciudad_Juarez` (`BUSINESS_TZ` en `src/utils/businessDate.ts`); todas las pantallas
calculan "hoy" con `getBusinessToday()`, nunca con la zona del navegador.
Migraciones: `20261003000001` … `20261003000007` (aplicadas en producción).

## Pantallas y rutas
| Ruta | Acceso (`src/utils/permissions.ts`) | Contenido |
|---|---|---|
| `/manager` | admin + manager (`canAccessManagerDashboard`); admin en solo lectura | Pestañas Notas, Inventario, Caja, Incidencias, Cerrar día |
| `/admin` | solo admin (`canAccessAdminDashboard`) | Alertas del dueño: caja, checklist, inventario del día, descuentos, salidas sin nota, ventas después del cierre |
| `/transactions` | admin, manager, cashier | Nombre del vendedor vía `get_staff_directory()` |

Componentes: `ManagerDashboard.tsx`, `AdminDashboard.tsx`, `CashTab.tsx`, `IncidentsTab.tsx`, `CloseDayTab.tsx`,
`FulfillmentForm.tsx`, `InventoryReport.tsx`.

## Tablas nuevas
| Tabla | Columnas clave | Escritura |
|---|---|---|
| `sale_verifications` | sale_id (UNIQUE), status pendiente/verificada/ajustada, user_id, updated_at | manager: insert/update |
| `sale_adjustments` | sale_id, field, original_value, new_value, reason, user_id, created_at | manager: solo insert (inmutable) |
| `sale_fulfillments` | sale_id (UNIQUE), picked_by, delivered_by, loaded_by, notes, created_at | manager: insert/update/delete |
| `sale_fulfillment_items` | fulfillment_id, sale_item_id (UNIQUE juntos), quantity_fulfilled | manager: insert/update/delete |
| `inventory_discrepancies` | product_id, quantity, reason (dano, merma, muestra, uso_interno, salida_sin_nota, error_captura, otro), notes, sale_id, user_id | manager: insert/update/delete |
| `incidents` | type (material_danado, faltante, cliente_inconforme, diferencia_caja, descuento_especial, entrega_incorrecta, salida_sin_nota, otro), description, sale_id, product_id, person_id, status pendiente/resuelta, user_id | manager: insert/update/delete |
| `cash_counts` | cash, card, other, abonos, user_id, created_at | manager: solo insert (inmutable; un reconteo es otra fila) |
| `daily_closings` | closing_date (UNIQUE), day_start, day_end, manager_id, closed_at, totals, discrepancies, incidents, checklist | solo vía `close_day()` (inmutable) |

Lectura: admin y manager en las 8 tablas. Cashier y customer: nada. Todas las políticas usan
`EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role ...)`.

## Funciones
| Función | Parámetros | Uso |
|---|---|---|
| `get_daily_inventory_report` | `p_date DATE, p_tz TEXT` | Inventario del día: inicial, entradas, vendido_pos, mermas, salidas, esperado, surtido, diferencia, justificado, sin_justificar |
| `get_daily_cash_summary` | `p_date, p_tz` | Esperado vs último conteo; JSON con expected/received/difference |
| `get_daily_closing_checklist` | `p_date, p_tz` | ventas_revisadas, dinero_conciliado, material_revisado, personal_registrado, diferencias_pendientes, incidencias_pendientes |
| `close_day` | `p_date, p_tz` | Único modo de crear `daily_closings`; solo manager; SECURITY DEFINER |
| `get_effective_day_start` | `p_date, p_tz` | Inicio real del día (cierre a tiempo del día anterior) |
| `get_sales_after_closing` | `p_tz` | Alerta de `/admin`: ventas posteriores al cierre de su día |
| `get_staff_directory` | — | Nombres del personal; solo devuelve filas a admin/manager |
| `get_current_user_role` | — | Rol del usuario actual (SECURITY DEFINER), usado por políticas |
| `enforce_open_day` + `manager_row_day_ts` | trigger | Candado de día cerrado en las 7 tablas del gerente |

## Decisiones
- El gerente opera; el dueño (admin) solo lee y recibe alertas en `/admin`.
- Una nota nunca se modifica: los ajustes son filas de auditoría en `sale_adjustments`.
- Diferencias de surtido se justifican en `inventory_discrepancies`; nunca se toca el stock desde el dashboard.
- Se puede cerrar con pendientes; quedan guardados en `daily_closings.checklist`.
- Día cerrado = solo lectura (error 42501 "Día cerrado: …"), salvo marcar una incidencia pendiente como `resuelta`.
- `created_at` se fuerza a `now()` al insertar (no se puede fechar hacia atrás para evadir el candado).
- El POS sigue vendiendo tras el cierre; esa venta pertenece al cierre del día siguiente y genera alerta al dueño.
- El candado termina en `LEAST(closed_at, day_end)`: un cierre tardío nunca bloquea el día siguiente.
- Caja: `other` es un cajón genérico (transferencias se registran como `card`); `abonos` = `shipments.advance_paid`
  de envíos sin venta; `devoluciones` = ventas `refunded`. Una diferencia se concilia con una incidencia `diferencia_caja`.

## Correcciones aplicadas
- `20261003000004`: `enforce_open_day` leía `OLD.status`/`NEW.status` directo y fallaba (42703) en toda tabla salvo
  `incidents`; ahora usa `to_jsonb(...)->>'status'`.
- `20261003000005`: registra la política real "Admins can view all users" + `get_current_user_role()`.
- `20261003000006`: ventas después del cierre, candado acotado a `day_end`, `get_effective_day_start`,
  idempotencia del trigger de stock, `purchases.delivery_date` en zona del negocio.
- `20261003000007`: políticas `auth.jwt() ->> 'role'` rotas en categories (modificar) y users (caja), ahora con `get_current_user_role()`.
- Commit `2041848`: carrera de `SIGNED_IN` en `authStore` (setTimeout).
- 2026-10-04: `InventoryReport.tsx` usaba la fecha y zona del navegador; ahora `getBusinessToday()` + `BUSINESS_TZ`.

## Verificación (2026-10-04)
- Build, `tsc --noEmit` sin errores; lint 63 problemas (preexistentes).
- Revisión estática: cada tabla, columna y RPC usada por las 8 pantallas existe con el mismo nombre y parámetros.
- Permisos: `/manager` admin+manager, `/admin` solo admin; cashier y customer sin acceso.
- Producción, solo lectura con cuentas QA: admin y manager reciben datos; cashier nada.
- Día completo en transacción revertida (fechas 2020), 45/45 PASS: venta de 10, verificar, surtir 8, justificar 2,
  conteo con diferencia + incidencia, checklist, `close_day`, candado (42501 "Día cerrado"), resolver incidencia,
  inmutabilidad, cierre tardío sin bloquear el día siguiente, venta después del cierre (verificada, surtida, contada
  al día siguiente y listada en la alerta), 6 consultas de `AdminDashboard` como admin, escrituras del admin denegadas.
  Revisión de residuos: 0 filas.

## Limitaciones conocidas
- `close_day()` siempre registra `closed_at = now()`; no hay cierre retroactivo a una hora pasada.
- Las listas de `/admin` de descuentos y salidas sin nota son las 20 más recientes globales, no del día.
- Cashier: `get_staff_directory()` le devuelve 0 filas, así que en Transactions no ve nombres de vendedor.
- La restricción del manager a "solo hoy" en Transactions es solo de frontend; la RLS de `sales` no filtra por fecha.
- Siguen activas políticas `auth.jwt() ->> 'role'` (nunca coinciden): "Admin and managers can modify products"
  (`20251219000001`) y las de `cash_adjustments` (`20260218000001`).
- `categories`: todos los roles leen 0 filas; la política de lectura es `USING (true)`, así que la tabla parece vacía (no confirmado sin service role).
- Un 406 visto una vez en el navegador no se ha reproducido.
- Sin bitácora de movimientos de inventario, sin tabla de pagos/abonos sobre ventas, devoluciones sin flujo,
  descuento sin UI ni autorización.
- `daily_stats_cache` / `get_dashboard_stats` existen pero no se usan.
- Sin pruebas automatizadas; verificación manual + scripts revertidos.
