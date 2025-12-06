# 🚀 Ready to Implement - Customer Role & Draft Orders

## 📊 Current Status: 70% Complete

### ✅ What's Already Done
- ✅ Database schema (draft_orders table, customer role)
- ✅ TypeScript types (DraftOrder, DraftOrderItem)
- ✅ Permissions system (customer role configured)
- ✅ Navigation (sidebar filtering)
- ✅ Basic POS structure

### 🎯 What Needs to Be Done (30% Remaining)

## Single File to Modify: `src/pages/POS.tsx`

### Changes Summary

#### 1. Add New Imports (4 lines)
```typescript
import { useAuthStore } from '../store/authStore';
import { hasPermission } from '../utils/permissions';
import { DraftOrder, DraftOrderItem } from '../types';
import { Save, FolderOpen } from 'lucide-react';
```

#### 2. Add State Variables (8 lines)
```typescript
const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
const [showDraftModal, setShowDraftModal] = useState(false);
const [showSaveDraftModal, setShowSaveDraftModal] = useState(false);
const [draftName, setDraftName] = useState('');
const [loadingDrafts, setLoadingDrafts] = useState(false);

const { user } = useAuthStore();
const userRole = user?.role || 'cashier';
const canCompleteSales = hasPermission(userRole, 'canCompleteSales');
const canViewQuantities = hasPermission(userRole, 'canViewQuantities');
const isCustomerRole = userRole === 'customer';
```

#### 3. Add API Functions (5 functions, ~150 lines)
- `fetchDraftOrders()` - Load user's drafts
- `saveDraftOrder()` - Save/update draft
- `loadDraftOrder()` - Load draft into cart
- `deleteDraftOrder()` - Delete draft
- `clearCurrentDraft()` - Reset draft state

#### 4. Add UI Components (2 modals, ~100 lines)
- Save Draft Modal (input for name)
- Draft List Modal (show/load/delete drafts)

#### 5. Modify Existing UI (~50 lines of changes)
- Product cards: Conditional quantity display
- Cart actions: Add draft buttons
- Payment button: Customer role adaptation
- Training mode indicator

#### 6. Add useEffect Hook (1 hook, ~5 lines)
```typescript
useEffect(() => {
  if (user?.id) {
    fetchDraftOrders();
  }
}, [user?.id, fetchDraftOrders]);
```

## 📝 Implementation Strategy

### Option A: Complete Implementation (Recommended)
**Time:** ~2.5 hours
**Approach:** Implement all features at once
**Benefits:** 
- Complete feature set
- Fully tested
- Production ready

### Option B: Phased Implementation
**Time:** ~3 hours (with testing between phases)
**Approach:** Implement in 3 phases
1. Phase 1: API functions only
2. Phase 2: UI components
3. Phase 3: Customer role adaptations

**Benefits:**
- Test each phase separately
- Easier to debug
- Can pause between phases

## 🎨 Visual Changes

### For Customer Role Users
**Before:** 
- See product quantities (e.g., "Stock: 45")
- Can complete payments
- No training indicator

**After:**
- See availability only (e.g., "In Stock" / "Out of Stock")
- Cannot complete payments (button says "Save as Draft for Staff")
- Training mode indicator: "🎓 Training Mode - Save drafts for staff to complete"

### For All Users
**New Features:**
- "Load Draft" button in cart
- "Save Draft" button in cart
- Draft list modal with load/delete actions
- "Editing Draft" badge when working on a loaded draft

## 🧪 Testing Checklist

### Customer Role Testing
- [ ] Login as customer role
- [ ] Verify only POS visible in sidebar
- [ ] Check products show "In Stock" not quantities
- [ ] Verify cannot complete payment
- [ ] Test saving draft
- [ ] Test loading draft
- [ ] Verify training mode indicator shows

### Draft Orders Testing (All Roles)
- [ ] Save draft with custom name
- [ ] Save draft without name (auto-generated)
- [ ] Load draft
- [ ] Edit and update draft
- [ ] Delete draft
- [ ] Multiple drafts management

### Edge Cases
- [ ] Empty cart save attempt
- [ ] Load draft with out-of-stock items
- [ ] Network errors

## 📋 Pre-Implementation Checklist

Before I start implementing, please confirm:

1. **Database Migrations**
   - [ ] Have you run the migrations in Supabase?
   - [ ] Or should I provide instructions to run them?

2. **Implementation Approach**
   - [ ] Option A: Complete implementation (recommended)
   - [ ] Option B: Phased implementation

3. **Questions (or accept recommendations)**
   - [ ] Draft auto-save: Manual only ✓
   - [ ] Draft naming: Optional with auto-generated fallback ✓
   - [ ] Stock validation: Adjust to available stock ✓
   - [ ] Customer access: Only their own drafts ✓

## 🚀 Next Steps

Once you approve, I will:

1. **Backup current POS.tsx** (create POS.tsx.backup)
2. **Implement all changes** to POS.tsx
3. **Test the implementation** (syntax check)
4. **Provide migration instructions** if needed
5. **Create testing guide** for manual testing

## ⏱️ Time Estimate

- Implementation: 1.5 hours
- Testing: 1 hour
- Documentation: 30 minutes
- **Total: 3 hours**

---

## 🎯 Ready to Start?

**Reply with one of:**
- ✅ "Proceed with complete implementation" (Option A)
- ✅ "Proceed with phased implementation" (Option B)
- ❓ "I have questions about..." (ask anything)
- 🔄 "Make these changes first..." (modifications needed)

I'm ready to complete this implementation and deliver a fully functional customer role with draft orders capability! 🚀
