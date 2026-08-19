# Role-Based Access Control (RBAC) and Customer Role

## Absorbed from
- `ROLES.md`
- `CUSTOMER_ROLE_UI_RESTRICTIONS.md`
- `CUSTOMER_ROLE_DRAFT_ORDERS_IMPLEMENTATION.md`

## Overview
This document defines user roles, permissions, UI restrictions for the `customer` role, and draft orders behavior.

## Roles & Permissions
The POS system has 4 user roles with different permissions: `admin`, `manager`, `cashier`, and `customer`.

### 🔴 Cashier
Limited access - focused on sales
- ✅ POS (Point of Sale)
- ✅ Customers
- ✅ Transactions
- ✅ Dashboard
- ❌ Products
- ❌ Purchases
- ❌ Reports
- ❌ Staff
- ❌ Settings

### 🟡 Manager
Limited operational access - no system administration
- ✅ POS (Point of Sale)
- ❌ Products
- ✅ Customers
- ✅ Purchases
- ✅ Reports (inventory-oriented: includes a stock/inventory overview card, since managers no longer have direct Products page access)
- ✅ Transactions (limited to today's date only; cannot view other days, no free date range picker)
- ✅ Dashboard
- ❌ Staff
- ❌ Settings

### 🟢 Admin
Full access to everything
- ✅ All pages (POS, Products, Customers, Purchases, Reports, Transactions, Staff, Settings, Dashboard)

### 🔵 Customer (new role)
Purpose: Training mode / customer-facing iPad
- ✅ Can access POS only (limited view)
- ✅ Can view products and availability (In Stock / Out of Stock)
- ✅ Can create draft orders
- ❌ Cannot complete sales / payments
- ❌ Cannot access transactions
- ❌ Cannot see exact stock quantities

## Permission Matrix (summary)
- `canAccessPOS`: admin, manager, cashier, customer
- `canCompleteSales`: admin, manager, cashier (customer = false)
- `canViewQuantities`: admin, manager, cashier (customer = false)
- `canAccessProducts`: admin only (cashier/manager/customer = false)
- `canAccessTransactions`: admin, manager, cashier (customer = false); manager and cashier are restricted to today's transactions only

Implementation reference: `src/utils/permissions.ts` contains the `rolePermissions` object and permission checks.

## How It Works
### 1. Database Level
- User roles are stored in the `users` table and enforced via Supabase Row Level Security (RLS) policies.

### 2. Frontend Level
- Route Protection: Routes are wrapped with `<ProtectedRoute>` component
- Menu Filtering: `src/components/Sidebar.tsx` filters menu items by allowed roles
- UI Elements: User's role is displayed in the header

### 3. Files Involved
- `src/utils/permissions.ts` - Role permission definitions
- `src/components/ProtectedRoute.tsx` - Route protection component
- `src/components/Sidebar.tsx` - Menu filtering
- `src/App.tsx` - Routes wrapped with protection

## Customer Role - UI Restrictions and Behavior
(From `CUSTOMER_ROLE_UI_RESTRICTIONS.md` and `CUSTOMER_ROLE_DRAFT_ORDERS_IMPLEMENTATION.md`)

### Dashboard
- Hide stats and time-range selectors for `customer` role.
- Show customer-friendly welcome message instead.

### POS page behavior for `customer` role
- Hide price display in product grid on mobile and desktop when `isCustomerRole === true` (prices remain visible in cart after adding items).
- Replace exact quantity numbers with availability status: show `In Stock` if `product.stock_quantity > 0`, otherwise `Out of Stock`.

Example conditional rendering (reference):
```typescript
{canViewQuantities ? (
	<p className="text-xs text-gray-500">Stock: {product.stock_quantity}</p>
) : (
	<p className="text-xs text-gray-500">
		{product.stock_quantity > 0 ? (
			<span className="text-green-600 font-medium">In Stock</span>
		) : (
			<span className="text-red-600 font-medium">Out of Stock</span>
		)}
	</p>
)}
```

### Cart & Payment
- For `customer` role, hide or replace the payment button with a `Save as Draft for Staff` action.
- When a staff user completes payment for a draft, the draft should be auto-deleted if `currentDraftId` exists.

Example replacement:
```typescript
{canCompleteSales ? (
	<button onClick={() => setShowPayment(true)} ...>Proceed to Payment</button>
) : (
	<button onClick={() => setShowSaveDraftModal(true)} ...>Save as Draft for Staff</button>
)}
```

### Draft Orders (All Roles)
Purpose: Save incomplete orders for later completion. Drafts are persisted in `draft_orders` table.

Draft features:
- Save current cart as draft (optional name)
- Load saved drafts
- Edit existing drafts
- Delete drafts
- Attach a customer to a draft
- Multiple drafts per user

Draft storage schema (reference from migrations):
- `draft_orders` table with fields: `id`, `user_id`, `customer_id`, `name`, `items` (JSONB), `subtotal`, `tax`, `shipping`, `total`, `notes`, `created_at`, `updated_at`.

Migration files:
- `supabase/migrations/20251205000001_add_customer_role.sql`
- `supabase/migrations/20251205000002_create_draft_orders.sql`

Draft orders table SQL:
```sql
CREATE TABLE draft_orders (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  customer_id UUID REFERENCES customers(id),
  name TEXT,
  items JSONB,
  subtotal DECIMAL(10,2),
  tax DECIMAL(10,2),
  shipping DECIMAL(10,2),
  total DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

Notes from the draft orders migration:
- Created indexes for performance
- Added auto-update trigger for updated_at

RLS (database) notes:
- Users can only manage their own drafts
- Admins/managers may have broader access per RLS policies

POS UI elements for drafts (reference):
- Save Draft modal (input for name)
- Draft List modal (load/delete actions)
- Save/Load buttons in cart
- Draft indicator badge ("Editing Draft")

Example `loadDraftOrder()` behavior (reference):
- Convert stored `draft.items` into cart items
- Fetch current product data to ensure stock availability
- Adjust quantities to available stock if needed
- Set `currentDraftId`, `selectedCustomer`, and `shippingCost` from draft

## Testing Roles
- To test different roles, create users in Supabase with different role values:
	- Create user in Supabase Auth
	- Add corresponding record in `users` table with role: `'admin'`, `'manager'`, `'cashier'`, or `'customer'`

## Notes & Implementation Status
- The customer role and draft orders migrations exist in `supabase/migrations`.
- TypeScript types for `DraftOrder` and `DraftOrderItem` should be present in `src/types/index.ts`.
- `src/pages/POS.tsx` contains POS changes and draft-order UI placeholders; final UI wiring may be in progress depending on implementation phase.

## Change Log / Absorbed details
This file consolidates role definitions and customer-specific UI/draft behavior from the absorbed documents. No factual content was changed; the original files are noted above as sources.
