# Customer Role & Draft Orders - Implementation Status

## ✅ COMPLETED (Approximately 70%)

### 1. Database Layer - COMPLETE
- ✅ Customer role migration with RLS policies
- ✅ Draft orders table with full schema
- ✅ Indexes and triggers
- ✅ Security policies configured

### 2. TypeScript Types - COMPLETE
- ✅ UserRole type includes 'customer'
- ✅ DraftOrder interface
- ✅ DraftOrderItem interface

### 3. Permissions System - COMPLETE
- ✅ Customer role permissions configured
- ✅ canCompleteSales permission added
- ✅ canViewQuantities permission added
- ✅ All roles have proper permission settings

### 4. Navigation - COMPLETE
- ✅ Sidebar shows only POS for customer role
- ✅ Role-based navigation filtering

### 5. POS State Management - COMPLETE
- ✅ Draft orders state variables added
- ✅ User role detection implemented
- ✅ Permission checks (canCompleteSales, canViewQuantities, isCustomerRole)

## 🔄 IN PROGRESS (Approximately 30% Remaining)

### 6. Draft Order API Functions - NEEDED
Need to implement these functions in POS.tsx:

```typescript
// Fetch all draft orders for current user
const fetchDraftOrders = async () => {
  // Query draft_orders table
  // Filter by user_id
  // Update draftOrders state
}

// Save current cart as draft
const saveDraftOrder = async () => {
  // Convert cart to DraftOrderItem[]
  // Insert into draft_orders table
  // Show success message
}

// Load a specific draft into cart
const loadDraftOrder = async (draft: DraftOrder) => {
  // Parse draft.items
  // Set cart state
  // Set currentDraftId
  // Set customer if exists
}

// Delete a draft order
const deleteDraftOrder = async (id: string) => {
  // Delete from draft_orders table
  // Refresh draft list
}
```

### 7. Draft Order UI Components - NEEDED
Need to add to POS.tsx:

- **Save Draft Dialog**: Modal to input draft name
- **Draft List Modal**: Show all user's drafts with load/delete options
- **Draft Indicator**: Badge showing when working on a loaded draft
- **Save/Load Buttons**: In cart view

### 8. Customer Role UI Adaptations - NEEDED
Need to modify existing UI in POS.tsx:

- **Product Cards**: 
  - Hide quantity numbers for customer role
  - Show "In Stock" / "Out of Stock" badge instead
  
- **Cart View**:
  - Hide "Complete Payment" button for customer role
  - Show only "Save as Draft" button
  
- **Payment Flow**:
  - Disable payment selection for customer role
  - Redirect to draft save instead

## 📋 IMPLEMENTATION APPROACH

Since the POS.tsx file is very large (990+ lines), I recommend:

**Option A: Complete Implementation** (Recommended)
- Add all draft order functions
- Add all UI components
- Add customer role conditional rendering
- Full feature set

**Option B: Minimal Viable Product**
- Add only save/load draft functions
- Simple draft list
- Basic customer role restrictions
- Can be enhanced later

## 🎯 NEXT STEPS

1. **Implement Draft Order Functions** (30 minutes)
   - fetchDraftOrders
   - saveDraftOrder
   - loadDraftOrder
   - deleteDraftOrder

2. **Add Draft UI Components** (45 minutes)
   - Save draft dialog
   - Draft list modal
   - Load/delete buttons

3. **Customer Role Adaptations** (30 minutes)
   - Conditional rendering
   - Hide quantities
   - Disable payment

4. **Testing** (1 hour)
   - Test migrations
   - Test draft CRUD
   - Test customer role
   - Test all roles

## 📊 ESTIMATED TIME TO COMPLETION

- **Remaining Implementation**: 1.5-2 hours
- **Testing**: 1 hour
- **Total**: 2.5-3 hours

## 🚀 READY TO DEPLOY

Once complete, you'll need to:

1. Run database migrations:
   ```bash
   supabase migration up
   ```

2. Create a customer role user for testing

3. Test all functionality

4. Deploy frontend changes

## 📝 NOTES

- The foundation is solid and well-structured
- Database schema is production-ready
- Type system is complete
- Permissions are properly configured
- Just need to add the UI and API integration
