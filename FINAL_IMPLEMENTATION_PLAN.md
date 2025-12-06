# Final Implementation Plan - Customer Role & Draft Orders

## Current Status: ~70% Complete

### ✅ COMPLETED
1. **Database Schema** - Customer role and draft_orders table created
2. **TypeScript Types** - DraftOrder and DraftOrderItem interfaces defined
3. **Permissions System** - Customer role with restricted permissions
4. **Navigation** - Sidebar filtering for customer role
5. **POS State** - Basic structure in place

### 🔄 REMAINING WORK (~30%)

## Phase 1: Add Draft Order State & API Functions to POS.tsx

### State Variables to Add:
```typescript
const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
const [showDraftModal, setShowDraftModal] = useState(false);
const [showSaveDraftModal, setShowSaveDraftModal] = useState(false);
const [draftName, setDraftName] = useState('');
const [loadingDrafts, setLoadingDrafts] = useState(false);
```

### User Role Detection:
```typescript
const { user } = useAuthStore();
const userRole = user?.role || 'cashier';
const canCompleteSales = hasPermission(userRole, 'canCompleteSales');
const canViewQuantities = hasPermission(userRole, 'canViewQuantities');
const isCustomerRole = userRole === 'customer';
```

### API Functions to Implement:

#### 1. fetchDraftOrders()
```typescript
const fetchDraftOrders = useCallback(async () => {
  if (!user?.id) return;
  
  try {
    setLoadingDrafts(true);
    const { data, error } = await supabase
      .from('draft_orders')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    setDraftOrders(data || []);
  } catch (error) {
    console.error('Error fetching drafts:', error);
    toast.error('Failed to load draft orders');
  } finally {
    setLoadingDrafts(false);
  }
}, [user?.id]);
```

#### 2. saveDraftOrder()
```typescript
const saveDraftOrder = async () => {
  if (!user?.id || cart.length === 0) {
    toast.error('Cart is empty');
    return;
  }

  try {
    const draftItems: DraftOrderItem[] = cart.map(item => ({
      product_id: item.id,
      product_name: item.name,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.price * item.quantity
    }));

    const draftData = {
      user_id: user.id,
      customer_id: selectedCustomer?.id || null,
      name: draftName || `Draft ${new Date().toLocaleString()}`,
      items: draftItems,
      subtotal,
      tax,
      shipping: shippingCost,
      total,
      notes: null
    };

    if (currentDraftId) {
      // Update existing draft
      const { error } = await supabase
        .from('draft_orders')
        .update(draftData)
        .eq('id', currentDraftId);

      if (error) throw error;
      toast.success('Draft updated successfully');
    } else {
      // Create new draft
      const { error } = await supabase
        .from('draft_orders')
        .insert([draftData]);

      if (error) throw error;
      toast.success('Draft saved successfully');
    }

    setShowSaveDraftModal(false);
    setDraftName('');
    setCart([]);
    setSelectedCustomer(null);
    setShippingCost(0);
    setCurrentDraftId(null);
    fetchDraftOrders();
  } catch (error) {
    console.error('Error saving draft:', error);
    toast.error('Failed to save draft');
  }
};
```

#### 3. loadDraftOrder()
```typescript
const loadDraftOrder = async (draft: DraftOrder) => {
  try {
    // Convert draft items to cart items
    const draftItems = draft.items as DraftOrderItem[];
    
    // Fetch current product data to ensure stock availability
    const productIds = draftItems.map(item => item.product_id);
    const { data: currentProducts, error } = await supabase
      .from('products')
      .select('*')
      .in('id', productIds);

    if (error) throw error;

    const cartItems: CartItem[] = draftItems.map(draftItem => {
      const product = currentProducts?.find(p => p.id === draftItem.product_id);
      if (!product) return null;

      return {
        ...product,
        quantity: Math.min(draftItem.quantity, product.stock_quantity)
      };
    }).filter(Boolean) as CartItem[];

    setCart(cartItems);
    setCurrentDraftId(draft.id);
    setShippingCost(draft.shipping);
    
    if (draft.customer_id) {
      const { data: customer } = await supabase
        .from('customers')
        .select('*')
        .eq('id', draft.customer_id)
        .single();
      
      if (customer) setSelectedCustomer(customer);
    }

    setShowDraftModal(false);
    toast.success(`Loaded draft: ${draft.name}`);
  } catch (error) {
    console.error('Error loading draft:', error);
    toast.error('Failed to load draft');
  }
};
```

#### 4. deleteDraftOrder()
```typescript
const deleteDraftOrder = async (id: string) => {
  try {
    const { error } = await supabase
      .from('draft_orders')
      .delete()
      .eq('id', id);

    if (error) throw error;
    
    toast.success('Draft deleted');
    fetchDraftOrders();
    
    if (currentDraftId === id) {
      setCurrentDraftId(null);
    }
  } catch (error) {
    console.error('Error deleting draft:', error);
    toast.error('Failed to delete draft');
  }
};
```

#### 5. clearCurrentDraft()
```typescript
const clearCurrentDraft = () => {
  setCurrentDraftId(null);
  setCart([]);
  setSelectedCustomer(null);
  setShippingCost(0);
};
```

## Phase 2: Add Draft Order UI Components

### 1. Save Draft Modal (Add before return statement)
```typescript
{showSaveDraftModal && (
  <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-xl max-w-md w-full p-6">
      <h3 className="text-lg font-semibold mb-4">Save Draft Order</h3>
      <input
        type="text"
        placeholder="Draft name (optional)"
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        className="w-full px-4 py-3 border rounded-lg mb-4"
        autoFocus
      />
      <div className="flex gap-3">
        <button
          onClick={() => {
            setShowSaveDraftModal(false);
            setDraftName('');
          }}
          className="flex-1 px-4 py-3 border rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={saveDraftOrder}
          className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg"
        >
          Save Draft
        </button>
      </div>
    </div>
  </div>
)}
```

### 2. Draft List Modal
```typescript
{showDraftModal && (
  <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="text-lg font-semibold">Draft Orders</h3>
        <button
          onClick={() => setShowDraftModal(false)}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4">
        {loadingDrafts ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : draftOrders.length > 0 ? (
          <div className="space-y-3">
            {draftOrders.map((draft) => (
              <div key={draft.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-semibold">{draft.name}</h4>
                    <p className="text-sm text-gray-600">
                      {draft.items.length} items • {formatCurrency(draft.total)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(draft.updated_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => loadDraftOrder(draft)}
                      className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deleteDraftOrder(draft.id)}
                      className="px-3 py-1 bg-red-600 text-white rounded-lg text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            <p>No draft orders</p>
          </div>
        )}
      </div>
    </div>
  </div>
)}
```

### 3. Draft Indicator Badge (Add near cart header)
```typescript
{currentDraftId && (
  <div className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm rounded-full">
    Editing Draft
  </div>
)}
```

### 4. Draft Action Buttons (Add to cart section)
```typescript
<div className="flex gap-2 mb-2">
  <button
    onClick={() => setShowDraftModal(true)}
    className="flex-1 px-4 py-2 border rounded-lg"
  >
    Load Draft
  </button>
  <button
    onClick={() => setShowSaveDraftModal(true)}
    disabled={cart.length === 0}
    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
  >
    Save Draft
  </button>
</div>
```

## Phase 3: Customer Role UI Adaptations

### 1. Hide Quantities in Product Cards
```typescript
// In product card rendering:
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

### 2. Hide/Replace Payment Button for Customer Role
```typescript
{canCompleteSales ? (
  <button
    onClick={() => setShowPayment(true)}
    disabled={cart.length === 0}
    className="w-full bg-blue-600 text-white py-3 rounded-lg"
  >
    Proceed to Payment
  </button>
) : (
  <button
    onClick={() => setShowSaveDraftModal(true)}
    disabled={cart.length === 0}
    className="w-full bg-blue-600 text-white py-3 rounded-lg"
  >
    Save as Draft
  </button>
)}
```

### 3. Add Training Mode Indicator
```typescript
{isCustomerRole && (
  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
    <p className="text-sm text-yellow-800 font-medium">
      🎓 Training Mode - Save drafts for staff to complete
    </p>
  </div>
)}
```

## Phase 4: useEffect Hooks

### Add to component:
```typescript
// Fetch drafts on mount
useEffect(() => {
  if (user?.id) {
    fetchDraftOrders();
  }
}, [user?.id, fetchDraftOrders]);
```

## Phase 5: Import Statements to Add

```typescript
import { useAuthStore } from '../store/authStore';
import { hasPermission } from '../utils/permissions';
import { DraftOrder, DraftOrderItem } from '../types';
import { Save, FolderOpen } from 'lucide-react';
```

## Testing Checklist

### Database
- [ ] Run migrations in Supabase
- [ ] Verify draft_orders table exists
- [ ] Test RLS policies

### Customer Role
- [ ] Create test customer user
- [ ] Verify can only see POS in sidebar
- [ ] Verify cannot see quantities (only In Stock/Out of Stock)
- [ ] Verify cannot complete payments
- [ ] Verify can save drafts

### Draft Orders (All Roles)
- [ ] Save new draft
- [ ] Load existing draft
- [ ] Update draft
- [ ] Delete draft
- [ ] Multiple drafts management
- [ ] Draft with customer attached
- [ ] Draft without customer

### Edge Cases
- [ ] Empty cart save attempt
- [ ] Load draft with out-of-stock items
- [ ] Concurrent draft edits
- [ ] Network errors

## Deployment Steps

1. **Database**
   ```bash
   supabase migration up
   ```

2. **Create Customer User**
   ```sql
   INSERT INTO users (email, role, first_name, last_name)
   VALUES ('customer@test.com', 'customer', 'Test', 'Customer');
   ```

3. **Deploy Frontend**
   - Commit changes
   - Push to repository
   - Netlify auto-deploy

## Estimated Time
- Phase 1 (API Functions): 45 minutes
- Phase 2 (UI Components): 45 minutes  
- Phase 3 (Customer Adaptations): 30 minutes
- Phase 4 & 5 (Hooks & Imports): 15 minutes
- Testing: 1 hour
- **Total: ~3 hours**

## Success Criteria

✅ Customer role can:
- Access only POS
- See product availability (not quantities)
- Save draft orders
- NOT complete sales
- NOT see transactions

✅ All roles can:
- Save multiple draft orders
- Load draft orders
- Edit existing drafts
- Delete drafts
- See draft indicator when editing

✅ System maintains:
- Data integrity
- Stock accuracy
- User permissions
- Audit trail
