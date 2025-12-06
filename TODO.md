# Implementation TODO List: Customer Role & Draft Orders

## Phase 1: Database Changes

### 1.1 Customer Role Migration
- [ ] Create migration file `supabase/migrations/[timestamp]_add_customer_role.sql`
  - [ ] Update users table CHECK constraint to include 'customer' role
  - [ ] Update RLS policies to restrict customer role access
  - [ ] Add indexes if needed

### 1.2 Draft Orders Table Migration
- [ ] Create migration file `supabase/migrations/[timestamp]_create_draft_orders.sql`
  - [ ] Create draft_orders table with proper schema
  - [ ] Add foreign key constraints
  - [ ] Enable RLS on draft_orders table
  - [ ] Create RLS policies for draft_orders (users can manage their own)
  - [ ] Add indexes for performance
  - [ ] Create triggers for updated_at timestamp

## Phase 2: TypeScript Type Updates

### 2.1 Update Type Definitions
- [ ] Update `src/types/index.ts`
  - [ ] Add 'customer' to UserRole type
  - [ ] Add DraftOrder interface
  - [ ] Add DraftOrderItem interface

## Phase 3: Permissions System

### 3.1 Update Permissions
- [ ] Update `src/utils/permissions.ts`
  - [ ] Add customer role to rolePermissions object
  - [ ] Set all permissions to false except canAccessPOS: true
  - [ ] Add new permission: canCompleteSales (false for customer)
  - [ ] Add new permission: canViewQuantities (false for customer)

## Phase 4: POS Page Updates

### 4.1 Draft Order Functionality
- [ ] Update `src/pages/POS.tsx`
  - [ ] Add draft orders state management
  - [ ] Add "Save as Draft" button
  - [ ] Add "Load Draft" functionality
  - [ ] Add draft orders list UI
  - [ ] Implement save draft function (API call)
  - [ ] Implement load draft function (API call)
  - [ ] Implement delete draft function (API call)
  - [ ] Add draft order indicator in UI
  - [ ] Add ability to switch between multiple drafts
  - [ ] Add draft name/label input

### 4.2 Customer Role View
- [ ] Update `src/pages/POS.tsx`
  - [ ] Add conditional rendering based on user role
  - [ ] Hide quantity display for customer role
  - [ ] Show availability status (In Stock/Out of Stock) for customer
  - [ ] Hide "Complete Payment" button for customer role
  - [ ] Show only "Save as Draft" for customer role
  - [ ] Simplify UI for iPad usage (larger touch targets)The user wants me to create a checklist for all needed changes and then systematically complete the todo list. Let me create a comprehensive TODO.md file with all the tasks needed to implement the customer role and draft orders functionality.
<create_file>
<path>TODO.md</path>
<content>
# Customer Role & Draft Orders Implementation

## Phase 1: Database Changes

### 1.1 Add Customer Role to Database
- [x] Create migration to update users table CHECK constraint to include 'customer' role
- [x] Update RLS policies to handle customer role restrictions
- [ ] Test database migration

### 1.2 Create Draft Orders Table
- [x] Create migration for `draft_orders` table with fields:
  - id (UUID, primary key)
  - user_id (UUID, references users)
  - customer_id (UUID, references customers, nullable)
  - items (JSONB, array of cart items)
  - subtotal (DECIMAL)
  - tax (DECIMAL)
  - shipping (DECIMAL)
  - total (DECIMAL)
  - notes (TEXT, nullable)
  - created_at (TIMESTAMPTZ)
  - updated_at (TIMESTAMPTZ)
- [x] Add RLS policies for draft orders (users can manage their own drafts)
- [x] Create indexes for performance

## Phase 2: TypeScript Type Updates

### 2.1 Update UserRole Type
- [x] Add 'customer' to UserRole type in `src/types/index.ts`

### 2.2 Add DraftOrder Interface
- [x] Add DraftOrder interface in `src/types/index.ts`
- [x] Add DraftOrderItem interface for cart items in drafts

## Phase 3: Permissions & Access Control

### 3.1 Update Permissions
- [x] Update `src/utils/permissions.ts` to add customer role permissions:
  - canAccessPOS: true (limited view)
  - canAccessProducts: false
  - canAccessCustomers: false
  - canAccessPurchases: false
  - canAccessReports: false
  - canAccessTransactions: false
  - canAccessStaff: false
  - canAccessSettings: false
- [x] Add canCompleteSales permission (false for customer)
- [x] Add canViewQuantities permission (false for customer)

### 3.2 Update Navigation
- [x] Update `src/components/Sidebar.tsx` to show only POS for customer role
- [ ] Update `src/App.tsx` protected routes if needed

## Phase 4: POS Functionality Updates

### 4.1 POS Imports and Setup
- [x] Add necessary imports (useAuthStore, hasPermission, DraftOrder types, icons)
- [ ] Add draft order state variables
- [ ] Add user role detection

### 4.2 Draft Order API Functions
- [ ] Create saveDraftOrder function
- [ ] Create loadDraftOrders function
- [ ] Create deleteDraftOrder function
- [ ] Create loadDraftOrder function (load specific draft into cart)

### 4.3 Draft Order UI Components
- [ ] Add "Save as Draft" button in cart view
- [ ] Add "Load Drafts" button/modal
- [ ] Add draft orders list modal
- [ ] Add draft name input dialog
- [ ] Add draft indicator badge

### 4.4 Customer Role View
- [ ] Add role-based conditional rendering
- [ ] Hide quantities for customer role (show In Stock/Out of Stock)
- [ ] Hide "Complete Payment" button for customer role
- [ ] Show only "Save as Draft" for customer role
- [ ] Adjust product cards for customer view

## Phase 5: Testing & Validation

### 5.1 Role Testing
- [ ] Test customer role login and access restrictions
- [ ] Verify customer cannot access restricted pages
- [ ] Test customer POS view functionality

### 5.2 Draft Order Testing
- [ ] Test draft order save/load functionality
- [ ] Test multiple concurrent draft orders
- [ ] Test auto-save functionality
- [ ] Test draft order deletion

### 5.3 Integration Testing
- [ ] Test RLS policies work correctly
- [ ] Test on iPad for customer role usability
- [ ] Test performance with multiple drafts

## Phase 6: Documentation & Cleanup

### 6.1 Update Documentation
- [ ] Update ROLES.md with customer role description
- [ ] Add draft orders documentation
- [ ] Update any relevant guides

### 6.2 Code Cleanup
- [ ] Remove any debug code
- [ ] Ensure proper error handling
- [ ] Code formatting and linting
