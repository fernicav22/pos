# AGENTS

## Project overview
POS system. React 18 + TypeScript + Vite + Supabase (Postgres, RLS, Auth). State via zustand. Deployment target: not confirmed in this pass.

## Commands
- `npm run dev` → `vite`
- `npm run build` → `vite build`
- `npm run lint` → `eslint .`
- `npm run preview` → `vite preview`
- No `test` script exists.
- No `typecheck` script exists.
- Ad hoc type check: `npx tsc --noEmit` works because `noEmit: true` is configured.

## Architecture
`src/` contains:
- `App.tsx`
- `components/`
- `config/`
- `data/`
- `hooks/`
- `i18n/`
- `index.css`
- `lib/`
- `main.tsx`
- `pages/`
- `store/`
- `types/`
- `utils/`
- `vite-env.d.ts`

(Topology inferred from folder names, not confirmed by code analysis beyond file structure.)

## Established patterns to reuse
- `initializeAuth()` / `fetchAndSetUser()` — singleton auth initialization in `authStore.ts`; use for auth startup and avoid duplicate initialization paths.
- `let fetchUserPromise: Promise<void> | null = null` + `if (fetchUserPromise) { return fetchUserPromise; }` — deduplicate in-flight auth user fetches; already fixed once, don’t reintroduce this bug.
- `let settingsLoadPromise: Promise<void> | null = null` — deduplicate settings load in `settingsStore.ts`; already fixed once, don’t reintroduce this bug.
- `cleanupAuthSubscription` + `window.addEventListener('beforeunload', cleanupAuthSubscription)` + `if (import.meta.hot) { import.meta.hot.dispose(() => cleanupAuthSubscription()); }` — auth listener cleanup pattern for hot reload and unload.
- `console.warn('Settings load timeout, proceeding with defaults')` — settings timeout fallback in `App.tsx`.
- `useDebounce` — debounce search/filter inputs, typically 300ms.
- `abortControllerRef` — cancel in-flight Supabase requests on unmount with AbortController.
- `isMountedRef` — guard state updates after unmount.
- `roundCurrency()` — use for all money math to avoid float precision issues.
- `setupPeriodicCleanup(300000)` — periodic memory cleanup for long-running sessions.
- Pagination limits:
  - POS page: 100 products
  - Transactions page: 100
  - Products page: 200
  - Shipments page: 200

## Database conventions
- Migration filenames use timestamp prefix + underscore + descriptive slug, e.g. `20251205000002_create_draft_orders.sql`.
- RLS is enabled per table via `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, observed on tables such as `users`, `categories`, `products`, `customers`, `sales`, `store_settings`, `draft_orders`, `shipments`, `shipment_items`.
- Policies are defined with `CREATE POLICY "..." ON table_name`. Prefer `EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND role IN (...))` for new policies. Migrations from `20251219000001_optimize_auth_performance.sql` onward experimented with `auth.jwt() ->> 'role' IN (...)` instead, but this project has **no custom Auth Hook that embeds the app role into the JWT**, so that claim never actually matches — confirmed 2026-08-19 when it caused a real "new row violates row-level security policy" failure on `shipments` (fixed in `20260819000002_fix_shipments_rls_use_users_table.sql`). Treat any existing `auth.jwt() ->> 'role'` policy (products/categories, cash_adjustments, users) as suspect until a real Auth Hook is verified.
- Indexes commonly use `CREATE INDEX IF NOT EXISTS`.
- `updated_at` columns use `CREATE TRIGGER ... EXECUTE FUNCTION update_updated_at_optimized()` for auto-update behavior (the current preferred trigger function, applied via `20251206000003_optimize_postgrest_operations.sql`).

## Roles & permissions
Roles: `admin`, `manager`, `cashier`, `customer`.

Permission functions include:
- `canAccessPOS` — admin, manager, cashier, customer
- `canCompleteSales` — admin, manager, cashier (customer = false)
- `canViewQuantities` — admin, manager, cashier (customer = false)
- `canAccessProducts` — admin only (manager access removed)
- `canAccessTransactions` — not customer; manager and cashier are restricted to today's transactions only (no free date range)
- `canAccessShipments` — admin, manager, cashier (customer = false), no date restriction

Customer role:
- Can access POS
- Can view products and availability
- Can create draft orders
- Cannot complete sales
- Cannot access transactions
- Cannot see exact stock quantities

Checks live in:
- `src/utils/permissions.ts`
- `src/components/ProtectedRoute.tsx`
- `src/components/Sidebar.tsx`
- `src/App.tsx`

Draft orders table fields:
- `id`
- `user_id`
- `customer_id`
- `name`
- `items`
- `subtotal`
- `tax`
- `shipping`
- `total`
- `notes`
- `created_at`
- `updated_at`

## Known limitations
- No automated test suite exists (confirmed by missing `test` script).
- Memory monitoring only works in Chrome (`performance.memory`); degrades gracefully elsewhere.
- No offline support — requires an active connection.
- No real-time sync between users — manual refresh needed to see others’ changes.
- Delivery evidence photos (Shipments module) live in a private Storage bucket with no server-side TTL/cron; expired (>15 day) photos are only pruned client-side when someone opens the Shipments page — best-effort, not a guaranteed hard deadline.

Because this codebase lacks automated tests today, verification rules should be treated as more important than in a tested codebase.

## Testing
Current verification is manual scenarios from `TESTING_GUIDE.md`:
- Page refresh test with expected `AuthStore` / `SettingsStore` console log sequence.
- Rapid repeated refresh test expecting `AuthStore: Deduplicating user fetch request`.
- Login flow test.
- Logout test.
- Simulated network timeout test.
- Settings load timeout test expecting `App: Settings load timeout, proceeding with defaults`.
- Hot reload in dev test expecting `AuthStore: Hot reload cleanup` and no listener buildup.
- Token refresh test expecting `TOKEN_REFRESHED event, session still valid`, no refetch, no UI flicker.
- Success criteria include exactly one user fetch per refresh and functioning 10s/5s timeout protections.

## Commit convention
Current practice is inconsistent and informal. Examples from recent commits:
- `auth fix`
- `load`
- `cashier`
- `Add customer role and draft orders feature`
- `UPGRADE`

Minimum going forward:
- Use a short imperative summary of what changed and why, e.g. `Fix settings load timeout not clearing on unmount`.

## Process discipline
- Canonical docs: `README.md`, `ROLES.md`, `AUTH.md`, `PERFORMANCE.md`, `BACKLOG.md`, `AUDIT.md`, `IMPLEMENTATION_HISTORY.md`, `TESTING_GUIDE.md`.
- No near-duplicate doc files.
- Never claim “done” / “verified” without showing actual command output or diff in the same response.
- Make minimal targeted changes only.
- Require explicit confirmation before any delete/overwrite.
- One file at a time on multi-file work.
- Remove temp/scratch files before finishing.
- List the final changed/created/deleted files at the end of any multi-step task.
