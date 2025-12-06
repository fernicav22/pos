# Implementation Plan for Approval

## Summary
Complete the customer role and draft orders functionality by adding:
1. Draft order API functions (save, load, delete)
2. Draft order UI components (modals, buttons)
3. Customer role UI adaptations (hide quantities, disable payments)

## Current State Analysis

### ✅ Already Complete (70%)
- Database schema with draft_orders table
- TypeScript types (DraftOrder, DraftOrderItem)
- Permissions system (customer role configured)
- Navigation filtering (customer sees only POS)
- POS.tsx basic structure

### 🔄 To Be Implemented (30%)

## Detailed Changes to POS.tsx

### 1. New Imports (Top of file)
```typescript
import { useAuthStore } from '../store/authStore';
import { hasPermission } from '../utils/permissions';
import { DraftOrder, DraftOrderItem } from '../types';
import { Save, FolderOpen } from 'lucide-react';
```

### 2. New State Variables (After existing useState declarations)
```typescript
// Draft orders state
const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
const [showDraftModal, setShowDraftModal] = useState(false);
const [showSaveDraftModal, setShowSaveDraftModal] = useState(false);
const [draftName, setDraftName] = useState('');
const [loadingDrafts, setLoadingDrafts] = useState(false);

// User permissions
const { user } = useAuthStore();
const userRole = user?.role || 'cashier';
const canCompleteSales = hasPermission(userRole, 'canCompleteSales');
const canViewQuantities = hasPermission(userRole, 'canViewQuantities');
const isCustomerRole = userRole === 'customer';
```

### 3. New API Functions (After existing functions)
- `fetchDraftOrders()` - Load user's draft orders
- `saveDraftOrder()` - Save/update draft order
- `loadDraftOrder()` - Load draft into cart
- `deleteDraftOrder()` - Delete a draft
- `clearCurrentDraft()` - Reset draft state

### 4. New UI Components (Before return statement)
- Save Draft Modal - Input for draft name
- Draft List Modal - Show all drafts with load/delete actions
- Draft Indicator Badge - Show when editing a draft

### 5. UI Modifications

#### Product Cards
**Before:**
```typescript
<p className="text-xs text-gray-500">Stock: {product.stock_quantity}</p>
```

**After:**
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

#### Cart Actions (Mobile & Desktop)
**Add draft buttons before payment button:**
```typescript
<div className="flex gap-2 mb-2">
  <button onClick={() => setShowDraftModal(true)} className="flex-1 px-4 py-2 border rounded-lg">
    <FolderOpen className="h-4 w-4 inline mr-2" />
    Load Draft
  </button>
  <button 
    onClick={() => setShowSaveDraftModal(true)}
    disabled={cart.length === 0}
    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg"
  >
    <Save className="h-4 w-4 inline mr-2" />
    Save Draft
  </button>
</div>
```

#### Payment Button (Customer Role)
**Replace payment button for customer role:**
```typescript
{canCompleteSales ? (
  <button onClick={() => setShowPayment(true)} ...>
    Proceed to Payment
  </button>
) : (
  <button onClick={() => setShowSaveDraftModal(true)} ...>
    Save as Draft for Staff
  </button>
)}
```

#### Training Mode Indicator
**Add at top of cart section for customer role:**
```typescript
{isCustomerRole && (
  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
    <p className="text-sm text-yellow-800 font-medium">
      🎓 Training Mode - Save drafts for staff to complete
    </p>
  </div>
)}
```

### 6. New useEffect Hook
```typescript
// Fetch drafts on mount
useEffect(() => {
  if (user?.id) {
    fetchDraftOrders();
  }
}, [user?.id, fetchDraftOrders]);
```

## File Structure

### Files to Modify
1. **src/pages/POS.tsx** - Main implementation (all changes above)

### Files Already Complete (No Changes Needed)
- ✅ src/types/index.ts
- ✅ src/utils/permissions.ts
- ✅ src/store/authStore.ts
- ✅ src/components/Sidebar.tsx
- ✅ supabase/migrations/20251205000001_add_customer_role.sql
- ✅ supabase/migrations/20251205000002_create_draft_orders.sql

## Implementation Approach

### Step-by-Step Process
1. **Add imports and state variables** to POS.tsx
2. **Implement API functions** for draft management
3. **Add UI modals** for save/load drafts
4. **Modify product cards** to conditionally show quantities
5. **Update cart actions** with draft buttons
6. **Add customer role indicators** and restrictions
7. **Add useEffect hook** to fetch drafts on mount
8. **Test thoroughly** with different roles

### Safety Measures
- ✅ All changes are additive (no breaking changes)
- ✅ Existing functionality remains intact
- ✅ Permissions checked before actions
- ✅ Error handling for all API calls
- ✅ Loading states for better UX
- ✅ Toast notifications for user feedback

## Testing Plan

### Manual Testing Required
1. **Customer Role**
   - [ ] Can only see POS in navigation
   - [ ] Cannot see product quantities (only In Stock/Out of Stock)
   - [ ] Cannot complete payments
   - [ ] Can save drafts
   - [ ] Sees training mode indicator

2. **Draft Orders (All Roles)**
   - [ ] Save new draft with custom name
   - [ ] Save draft with auto-generated name
   - [ ] Load existing draft
   - [ ] Update loaded draft
   - [ ] Delete draft
   - [ ] Multiple drafts management
   - [ ] Draft with customer attached
   - [ ] Draft without customer

3. **Edge Cases**
   - [ ] Empty cart save attempt (should show error)
   - [ ] Load draft with out-of-stock items (should adjust quantities)
   - [ ] Network errors (should show error toast)

## Estimated Implementation Time
- Code changes: 1.5 hours
- Testing: 1 hour
- **Total: 2.5 hours**

## Questions Before Proceeding

1. **Draft Auto-Save**: Should drafts auto-save periodically, or only on manual save?
   - Recommendation: Manual save only (simpler, more predictable)

2. **Draft Naming**: Should draft names be required or optional?
   - Recommendation: Optional with auto-generated fallback

3. **Stock Validation**: When loading a draft, if items are out of stock, should we:
   - A) Remove them from cart
   - B) Set quantity to 0 but keep in cart
   - C) Adjust to available stock
   - Recommendation: C (adjust to available stock)

4. **Customer Role Access**: Should customer role see their own saved drafts or all drafts?
   - Recommendation: Only their own drafts (current implementation)

## Approval Required

Please confirm:
- [ ] You approve this implementation plan
- [ ] You want me to proceed with all changes
- [ ] You have reviewed the questions above (or accept recommendations)

Once approved, I will:
1. Implement all changes to POS.tsx
2. Test the implementation
3. Provide a summary of changes
4. Guide you through database migration steps

---

**Ready to proceed?** Reply with "Proceed with the plan" or provide feedback on any changes needed.
