# Customer Role UI Restrictions Implementation

## Overview
Implement UI restrictions for customer role to hide sensitive business information while allowing them to browse products and create draft orders.

## Implementation Steps

### ✅ Step 1: Dashboard.tsx - Hide Stats for Customer Role
- [ ] Import `useAuthStore` to access user role
- [ ] Add conditional rendering to hide stat cards for customers
- [ ] Show customer-friendly welcome message instead
- [ ] Keep time range selector hidden for customers

### ✅ Step 2: POS.tsx - Hide Prices in Product List
- [ ] Hide price display in mobile product grid when `isCustomerRole === true`
- [ ] Hide price display in desktop product grid when `isCustomerRole === true`
- [ ] Keep stock status visible (In Stock/Out of Stock)
- [ ] Prices remain visible in cart after adding items ✓ (already working)
- [ ] Exact quantities already hidden ✓ (already working)

### ✅ Step 3: POS.tsx - Auto-delete Draft Orders on Completion
- [ ] Modify `handlePayment` function to delete draft order after successful sale
- [ ] Only delete if `currentDraftId` exists
- [ ] Clear `currentDraftId` state after deletion
- [ ] Show success message indicating draft was completed

## Expected Behavior

### Customer Role:
1. **Dashboard**: Shows welcome message, no business stats
2. **Product List**: Shows only product name and stock status (no prices, no quantities)
3. **Cart**: Prices visible after adding to cart
4. **Draft Orders**: Automatically deleted when staff completes the sale

### Other Roles (Admin, Manager, Cashier):
- All existing functionality remains unchanged
- Full access to stats, prices, and quantities

## Files Modified
1. `src/pages/Dashboard.tsx`
2. `src/pages/POS.tsx`
