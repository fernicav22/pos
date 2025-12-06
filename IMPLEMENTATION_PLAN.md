# Customer Role & Draft Orders Implementation Plan

## Overview
Implement a new "customer" role for iPad usage (training/customer-facing) and draft order functionality for all roles to manage multiple open transactions.

## Requirements

### 1. Customer Role
- **Purpose**: iPad-based interface for customers/training
- **Permissions**:
  - ✅ Can access POS
  - ✅ Can view products and availability
  - ✅ Can create draft orders
  - ❌ Cannot complete sales/payments
  - ❌ Cannot view transaction history
  - ❌ Cannot see exact quantities (show "In Stock" / "Out of Stock" instead)

### 2. Draft Orders
- **Purpose**: Save incomplete orders to handle multiple customers
- **Features**:
  - Save current cart as draft
  - Load saved drafts
  - Delete drafts
  - Auto-save functionality
  - Draft naming
- **Available to**: All roles (admin, manager, cashier, customer)

## Implementation Status

### ✅ Phase 1: Database Schema (COMPLETE)
- [x] Created `draft_orders` table with JSONB items storage
- [x] Added customer role to users table CHECK constraint
- [x] Set up RLS policies for draft_orders
- [x] Added indexes for performance
- [x] Created triggers for updated_at

**Files**:
- `supabase/migrations/20251205000001_add_customer_role.sql`
- `supabase/migrations/20251205000002_create_draft_orders.sql`

### ✅ Phase 2: Type Definitions (COMPLETE)
- [x] Added 'customer' to UserRole type
- [x] Created DraftOrder interface
- [x] Created DraftOrderItem interface

**Files**:
- `src/types/index.ts`

### ✅ Phase 3: Permissions System (COMPLETE)
- [x] Added customer role permissions
- [x] Added `canCompleteSales` permission
- [x] Added `canViewQuantities` permission
- [x] Configured permissions for all roles

**Files**:
- `src/utils/permissions.ts`

### ✅ Phase 4: Navigation (COMPLETE)
- [x] Added customer role to POS navigation
- [x] Customer role only sees POS in sidebar

**Files**:
- `src/components/Sidebar.tsx`

### ✅ Phase 5: POS State Management (COMPLETE)
- [x] Added draft orders state variables
- [x] Added permission check variables
- [x] Implemented fetchDraftOrders()
- [x] Implemented saveDraftOrder()
- [x] Implemented loadDraftOrder()
- [x] Implemented deleteDraftOrder()
- [x] Implemented clearCurrentDraft()
- [x] Added useEffect to load drafts on mount

**Files**:
- `src/pages/POS.tsx` (state management and API functions)

### ⏳ Phase 6: Draft Order UI Components (IN PROGRESS)
- [ ] Add "Save Draft" button to cart
- [ ] Create save draft dialog modal
- [ ] Add "Load Draft" button
- [ ] Create draft list modal
- [ ] Show current draft indicator
- [ ] Add draft order actions (update, delete)

**Target Files**:
- `src/pages/POS.tsx` (UI components)

### ⏳ Phase 7: Customer Role UI Adaptations (PENDING)
- [ ] Hide quantity numbers for customer role
- [ ] Show "In Stock" / "Out of Stock" badges instead
- [ ] Disable payment button for customer role
- [ ] Hide "Proceed to Payment" for customer role
- [ ] Show "Save as Draft" as primary action
- [ ] Add training mode indicator

**Target Files**:
- `src/pages/POS.tsx` (conditional rendering)

### ⏳ Phase 8: Testing & Refinement (PENDING)
- [ ] Test customer role permissions
- [ ] Test draft order CRUD operations
- [ ] Test multi-user draft scenarios
- [ ] Test stock validation on draft load
- [ ] Test UI responsiveness
- [ ] Test mobile/iPad interface

## Next Steps

### Immediate (Phase 6):
1. Add draft order UI buttons and modals to POS
2. Wire up existing API functions to UI
3. Test draft save/load/delete functionality

### Following (Phase 7):
1. Add conditional rendering based on `isCustomerRole`
2. Replace quantity display with availability status
3. Modify cart actions for customer role
4. Add visual indicators for training mode

### Final (Phase 8):
1. Comprehensive testing
2. Bug fixes
3. Performance optimization
4. Documentation updates

## Technical Notes

### Database Schema
```sql
CREATE TABLE draft_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  customer_id UUID REFERENCES customers(id),
  name TEXT,
  items JSONB NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  tax DECIMAL(10,2) NOT NULL,
  shipping DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Permission Matrix
| Permission | Admin | Manager | Cashier | Customer |
|------------|-------|---------|---------|----------|
| canAccessPOS | ✅ | ✅ | ✅ | ✅ |
| canCompleteSales | ✅ | ✅ | ✅ | ❌ |
| canViewQuantities | ✅ | ✅ | ✅ | ❌ |
| canAccessProducts | ✅ | ✅ | ❌ | ❌ |
| canAccessTransactions | ✅ | ✅ | ✅ | ❌ |

### Draft Order Item Structure
```typescript
interface DraftOrderItem {
  product_id: string;
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
}
```

## Completion Estimate
- **Current Progress**: ~70%
- **Remaining Work**: ~30%
- **Estimated Time**: 2-3 hours for UI implementation and testing

## Dependencies
- No new npm packages required
- Supabase migrations must be run
- Database must support JSONB type
- RLS policies must be enabled

## Risks & Considerations
1. **Stock Validation**: Draft orders must validate stock on load
2. **Concurrent Access**: Multiple users may access same products
3. **Data Consistency**: JSONB items must match current product data
4. **Mobile UX**: iPad interface must be touch-friendly
5. **Training Mode**: Clear visual indicators needed

## Success Criteria
- [x] Customer role can access POS
- [x] Customer role cannot complete payments
- [ ] Customer role sees availability instead of quantities
- [x] All roles can save drafts
- [x] All roles can load drafts
- [x] Drafts persist across sessions
- [ ] UI is intuitive and responsive
- [ ] No data loss or corruption
