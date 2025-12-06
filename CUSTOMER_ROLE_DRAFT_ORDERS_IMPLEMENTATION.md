# Customer Role & Draft Orders Implementation Summary

## Overview
This document summarizes the implementation of:
1. **Customer Role**: A new limited-access role for iPad usage by customers
2. **Draft Orders**: Functionality to save and manage multiple incomplete orders

## Completed Work

### Phase 1: Database Changes ✅

#### 1.1 Customer Role Migration
**File**: `supabase/migrations/20251205000001_add_customer_role.sql`

- Updated `users` table CHECK constraint to include 'customer' role
- Modified RLS policies to restrict customer role access:
  - Customers CANNOT view sales or sale_items
  - Customers CANNOT create actual sales (only drafts)
  - Customers CAN view products and categories
  - Customers CANNOT view/modify other customers
  - Customers CANNOT access purchases or suppliers

#### 1.2 Draft Orders Table
**File**: `supabase/migrations/20251205000002_create_draft_orders.sql`

- Created `draft_orders` table with:
  - UUID primary key
  - Foreign keys to users and customers
  - JSONB field for cart items
  - Financial fields (subtotal, tax, shipping, total)
  - Optional name and notes fields
  - Timestamps (created_at, updated_at)
- Added RLS policies:
  - Users can view/manage their own drafts
  - Admins/managers can view all drafts
  - Admins/managers can delete any drafts
- Created indexes for performance
- Added auto-update trigger for updated_at

### Phase 2: TypeScript Type Updates ✅

**File**: `src/types/index.ts`

- Added 'customer' to `UserRole` type
- Created `DraftOrder` interface
- Created `DraftOrderItem` interface

### Phase 3: Permissions & Access Control ✅

#### 3.1 Permissions
**File**: `src/utils/permissions.ts`

- Added customer role to `rolePermissions` with:
  - `canAccessPOS`: true (limited view)
  - `canCompleteSales`: false
  - `canViewQuantities`: false
  - All other permissions: false
- Added new permissions for all roles:
  - `canCompleteSales`: Controls ability to complete payments
  - `canViewQuantities`: Controls visibility of stock quantities

#### 3.2 Navigation
**File**: `src/components/Sidebar.tsx`

- Updated navigation to show only POS for customer role
- Customer role will see only "Point of Sale" in sidebar

### Phase 4: POS Updates (In Progress) 🔄

**File**: `src/pages/POS.tsx`

- ✅ Added necessary imports:
  - `useAuthStore` for user role detection
  - `hasPermission` for permission checks
  - `DraftOrder` and `DraftOrderItem` types
  - Icons: `Save`, `FolderOpen`, `Trash2`

## Remaining Work

### Phase 4: POS Functionality (Continued)

#### 4.1 State Management
Need to add:
```typescript
const { user } = useAuthStore();
const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
const [showDraftModal, setShowDraftModal] = useState(false);
const [showSaveDraftDialog, setShowSaveDraftDialog] = useState(false);
const [draftName, setDraftName] = useState('');
```

#### 4.2 Draft Order API Functions
Need to implement:
- `saveDraftOrder()`: Save current cart as draft
- `loadDraftOrders()`: Fetch all user's drafts
- `deleteDraftOrder(id)`: Delete a specific draft
- `loadDraftIntoCart(draft)`: Load draft items into cart

#### 4.3 UI Components
Need to add:
- "Save as Draft" button in cart view
- "Load Drafts" button to open draft list
- Draft orders list modal
- Draft name input dialog
- Draft indicator badge (when working on a loaded draft)

#### 4.4 Customer Role View
Need to implement:
- Conditional rendering based on `user?.role === 'customer'`
- Hide stock quantities, show "In Stock" / "Out of Stock"
- Hide "Complete Payment" button
- Show only "Save as Draft" button
- Larger touch targets for iPad usage

### Phase 5: Testing
- Test customer role login and restrictions
- Test draft order CRUD operations
- Test multiple concurrent drafts
- Test customer POS view on iPad
- Verify RLS policies work correctly

### Phase 6: Documentation
- Update ROLES.md with customer role description
- Document draft orders feature
- Update user guides

## Key Features

### Customer Role
- **Purpose**: Allow customers to use iPad to browse products and prepare orders
- **Permissions**: Can only access POS, cannot complete sales
- **View**: Simplified interface showing availability instead of quantities
- **Use Case**: Training, customer self-service, order preparation

### Draft Orders
- **Purpose**: Save incomplete orders for later completion
- **Benefits**: 
  - Handle multiple customers simultaneously
  - Save work in progress
  - Resume orders later
  - Reduce errors from switching between customers
- **Access**: All roles can create and manage drafts
- **Storage**: Persisted in database with full cart state

## Database Schema

### draft_orders Table
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

## Security

### RLS Policies
- Customer role cannot view/create actual sales
- Customer role cannot access transactions
- Users can only manage their own drafts
- Admins/managers have full draft access
- All policies enforce role-based access control

## Next Steps

1. Complete POS.tsx implementation with draft functionality
2. Add customer role conditional rendering
3. Test all functionality thoroughly
4. Update documentation
5. Deploy database migrations
6. Train staff on new features

## Migration Instructions

1. Run migrations in order:
   ```bash
   # Apply customer role migration
   supabase migration up 20251205000001_add_customer_role.sql
   
   # Apply draft orders migration
   supabase migration up 20251205000002_create_draft_orders.sql
   ```

2. Create customer role users in database
3. Test customer role access restrictions
4. Test draft order functionality
5. Deploy frontend changes

## Notes

- Customer role is designed for iPad usage with larger touch targets
- Draft orders auto-save timestamps for tracking
- Multiple drafts can be open simultaneously
- Drafts persist across sessions
- Admins can view/manage all drafts for oversight
