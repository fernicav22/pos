# Role-Based Access Control (RBAC)

## Overview
The POS system has 3 user roles with different permissions:

## Roles & Permissions

### 🔴 Cashier
**Limited access - focused on sales**
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
**Full operational access - no system administration**
- ✅ POS (Point of Sale)
- ✅ Products
- ✅ Customers
- ✅ Purchases
- ✅ Reports
- ✅ Transactions
- ✅ Dashboard
- ❌ Staff
- ❌ Settings

### 🟢 Admin
**Full access to everything**
- ✅ All pages (POS, Products, Customers, Purchases, Reports, Transactions, Staff, Settings, Dashboard)

## How It Works

### 1. Database Level
User roles are stored in the `users` table and enforced via Supabase Row Level Security (RLS) policies.

### 2. Frontend Level
- **Route Protection**: Routes are wrapped with `<ProtectedRoute>` component
- **Menu Filtering**: Sidebar only shows menu items for allowed roles
- **UI Elements**: User's role is displayed in the header

### 3. Files Involved
- `src/utils/permissions.ts` - Role permission definitions
- `src/components/ProtectedRoute.tsx` - Route protection component
- `src/components/Sidebar.tsx` - Already filters menu items by role
- `src/App.tsx` - Routes wrapped with protection

## Testing Roles
To test different roles, create users in Supabase with different role values:
- Create user in Supabase Auth
- Add corresponding record in `users` table with role: `'admin'`, `'manager'`, or `'cashier'`

## Access Denied
When a user tries to access a page they don't have permission for:
- They see an "Access Denied" message
- Their current role is displayed
- They cannot access the page content

## Notes
- Dashboard is accessible to all authenticated users
- Login page is always accessible
- Role is fetched from database on login
- Role is checked on every protected route
