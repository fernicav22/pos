import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, CreditCard, Banknote, UserPlus, Split, ArrowLeft, Package, X, Save, FolderOpen, Receipt, Mail, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { checkStock } from '../utils/inventory';
import { useSettingsStore } from '../store/settingsStore';
import { useDebounce } from '../hooks/useDebounce';
import { useAuthStore } from '../store/authStore';
import { hasPermission } from '../utils/permissions';
import { DraftOrder, DraftOrderItem } from '../types';
import { roundCurrency, calculateTaxAmount, calculateTotal } from '../utils/currency';

interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  price: number;
  cost: number;
  category_id?: string;
  description?: string;
  stock_quantity: number;
  low_stock_alert: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface CartItem extends Product {
  quantity: number;
}

interface TransactionItem {
  id: string;
  product: {
    name: string;
    sku: string;
  };
  quantity: number;
  price: number;
  subtotal: number;
}

interface CompletedSale {
  id: string;
  created_at: string;
  total: number;
  subtotal: number;
  tax: number;
  shipping: number;
  payment_method: string;
  payment_status: string;
  customer_id: string | null;
  user: {
    first_name: string;
    last_name: string;
  } | null;
  customer?: {
    first_name: string;
    last_name: string;
    email?: string;
  } | null;
  items: TransactionItem[];
}

export default function POS() {
  const { settings, formatCurrency, calculateTax } = useSettingsStore();
  const { user } = useAuthStore();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [showPayment, setShowPayment] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [shippingCost, setShippingCost] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [cashReceived, setCashReceived] = useState('');
  const [cardAmount, setCardAmount] = useState(0);
  
  // Payment processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);
  
  // Draft orders state
  const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [showSaveDraftModal, setShowSaveDraftModal] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  
  // User permissions
  const userRole = user?.role || 'cashier';
  const canCompleteSales = hasPermission(userRole, 'canCompleteSales');
  const canViewQuantities = hasPermission(userRole, 'canViewQuantities');
  const isCustomerRole = userRole === 'customer';
  
  // Use refs to track mounted state and abort controller
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isProcessingRef = useRef(false);  // ✅ Use ref for synchronous state check
  const lastPaymentClickRef = useRef(0);  // ✅ Track last payment button click time for debouncing
  
  // Debounce search query to prevent excessive filtering
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const debouncedCustomerSearchQuery = useDebounce(customerSearchQuery, 300);

  // Memoize filtered products to prevent unnecessary recalculations
  const filteredProducts = useMemo(() => {
    if (debouncedSearchQuery.trim()) {
      // Split search query into individual words and filter out empty strings
      const searchWords = debouncedSearchQuery.toLowerCase().split(/\s+/).filter(word => word.length > 0);
      
      return products.filter(product => {
        const productName = product.name.toLowerCase();
        const productSku = product.sku.toLowerCase();
        
        // Check if ALL search words exist in either product name or SKU
        return searchWords.every(word => 
          productName.includes(word) || productSku.includes(word)
        );
      });
    }
    return products;
  }, [debouncedSearchQuery, products]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchProducts();
    fetchCategories();
    if (user?.id) {
      fetchDraftOrders();
    }
    
    return () => {
      isMountedRef.current = false;
      // Cancel any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [user?.id]);

  // Fetch customers when search modal opens or search query changes
  useEffect(() => {
    if (showCustomerSearch) {
      fetchCustomers();
    }
  }, [showCustomerSearch, debouncedCustomerSearchQuery]);

  const fetchProducts = useCallback(async () => {
    try {
      // Create new abort controller for this request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      if (isMountedRef.current) {
        setLoading(true);
      }
      
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .gt('stock_quantity', 0)
        .order('name')
        .abortSignal(abortControllerRef.current.signal);

      if (error) throw error;

      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setProducts(data || []);
      }
    } catch (error: any) {
      // Ignore abort errors
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Error fetching products:', error);
      if (isMountedRef.current) {
        toast.error('Failed to load products');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .order('name');

      if (error) throw error;

      if (isMountedRef.current) {
        setCategories(data || []);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      if (isMountedRef.current) {
        toast.error('Failed to load categories');
      }
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      setLoadingCustomers(true);
      
      let query = supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      // Apply search filter if there's a search query
      if (debouncedCustomerSearchQuery.trim()) {
        const searchTerm = debouncedCustomerSearchQuery.toLowerCase();
        query = query.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`);
      }

      const { data, error } = await query.limit(50);

      if (error) throw error;

      if (isMountedRef.current) {
        setCustomers(data || []);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
      if (isMountedRef.current) {
        toast.error('Failed to load customers');
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingCustomers(false);
      }
    }
  }, [debouncedCustomerSearchQuery]);

  const fetchDraftOrders = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      setLoadingDrafts(true);
      
      // Build query based on user role
      let query = supabase
        .from('draft_orders')
        .select('*');
      
      // Only customer role is restricted to their own drafts
      // Admin, manager, and cashier can see all draft orders
      if (userRole === 'customer') {
        query = query.eq('user_id', user.id);
      }
      
      const { data, error } = await query.order('updated_at', { ascending: false });

      if (error) throw error;
      if (isMountedRef.current) {
        setDraftOrders(data || []);
      }
    } catch (error) {
      console.error('Error fetching drafts:', error);
      if (isMountedRef.current) {
        toast.error('Failed to load draft orders');
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingDrafts(false);
      }
    }
  }, [user?.id, userRole]);

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

      // Calculate values locally for the draft
      const draftSubtotal = roundCurrency(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
      const draftTax = roundCurrency(calculateTax(draftSubtotal));
      const draftTotal = roundCurrency(draftSubtotal + draftTax + shippingCost);

      const draftData = {
        user_id: user.id,
        customer_id: selectedCustomer?.id || null,
        name: draftName || `Draft ${new Date().toLocaleString()}`,
        items: draftItems,
        subtotal: draftSubtotal,
        tax: draftTax,
        shipping: roundCurrency(shippingCost),
        total: draftTotal,
        notes: null
      };

      if (currentDraftId) {
        // Update existing draft and return the updated data
        const { data, error } = await supabase
          .from('draft_orders')
          .update(draftData)
          .eq('id', currentDraftId)
          .select()
          .single();

        if (error) throw error;
        toast.success('Draft updated');
        
        // Update local state with returned data
        if (data) {
          setDraftOrders(prev => prev.map(d => d.id === currentDraftId ? data : d));
        }
      } else {
        // Insert new draft and return the created data
        const { data, error } = await supabase
          .from('draft_orders')
          .insert([draftData])
          .select()
          .single();

        if (error) throw error;
        toast.success('Draft saved');
        
        // Add to local state immediately
        if (data) {
          setDraftOrders(prev => [data, ...prev]);
        }
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

  const loadDraftOrder = async (draft: DraftOrder) => {
    try {
      const draftItems = draft.items as DraftOrderItem[];
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
      
      if (draft.customerId) {
        const { data: customer } = await supabase
          .from('customers')
          .select('*')
          .eq('id', draft.customerId)
          .single();
        
        if (customer) setSelectedCustomer(customer);
      }

      setShowDraftModal(false);
      toast.success(`Loaded: ${draft.name}`);
    } catch (error) {
      console.error('Error loading draft:', error);
      toast.error('Failed to load draft');
    }
  };

  const deleteDraftOrder = async (id: string) => {
    try {
      // Optimistic update: remove from state immediately
      const draftToDelete = draftOrders.find(d => d.id === id);
      setDraftOrders(prev => prev.filter(d => d.id !== id));

      const { error } = await supabase
        .from('draft_orders')
        .delete()
        .eq('id', id);

      if (error) {
        // Rollback on error
        if (draftToDelete) {
          setDraftOrders(prev => [draftToDelete, ...prev]);
        }
        throw error;
      }
      
      toast.success('Draft deleted');
      
      if (currentDraftId === id) {
        setCurrentDraftId(null);
      }
    } catch (error) {
      console.error('Error deleting draft:', error);
      toast.error('Failed to delete draft');
    }
  };

  const handleSelectCustomer = (customer: any) => {
    setSelectedCustomer(customer);
    setShowCustomerSearch(false);
    setCustomerSearchQuery('');
    toast.success(`Customer ${customer.first_name} ${customer.last_name} added`);
  };

  const handleAddToCart = (product: Product) => {
    const existingItem = cart.find(item => item.id === product.id);
    
    if (existingItem) {
      if (existingItem.quantity >= product.stock_quantity) {
        toast.error('Maximum stock quantity reached');
        return;
      }
      setCart(cart.map(item =>
        item.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
  };

  const handleQuantityChange = (id: string, newQuantity: number) => {
    const product = products.find(p => p.id === id);
    if (!product) return;

    if (newQuantity > product.stock_quantity) {
      toast.error('Quantity cannot exceed available stock');
      return;
    }

    if (newQuantity < 1) {
      setCart(cart.filter(item => item.id !== id));
      return;
    }

    setCart(cart.map(item =>
      item.id === id ? { ...item, quantity: newQuantity } : item
    ));
  };

  // Use proper currency rounding to avoid floating point issues
  const subtotal = roundCurrency(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const tax = roundCurrency(calculateTax(subtotal));
  const total = roundCurrency(subtotal + tax + shippingCost);

  // Check if paymentMethod is valid (not the 'selecting' placeholder)
  const isValidPaymentMethod = ['cash', 'card', 'split'].includes(paymentMethod);

  const handlePaymentClick = () => {
    // Prevent too-rapid payment attempts (less than 500ms apart)
    const now = Date.now();
    if (now - lastPaymentClickRef.current < 500) {
      console.warn('Payment button clicked too quickly, ignoring');
      return;
    }
    lastPaymentClickRef.current = now;
    
    // Call the actual payment handler
    handlePayment();
  };

  const handlePayment = async () => {
    // ✅ Use ref-based guard to prevent race conditions (synchronous check)
    if (isProcessingRef.current) {
      console.warn('Payment already processing, ignoring duplicate request');
      return;
    }

    try {
      if (!isValidPaymentMethod) {
        toast.error('Please select a valid payment method');
        return;
      }

      // ✅ Set ref immediately before async operations
      isProcessingRef.current = true;
      setIsProcessing(true);

      // First check if we have sufficient stock for all items
      const stockCheck = await checkStock(
        cart.map(item => ({
          product_id: item.id,
          quantity: item.quantity
        }))
      );

      if (!stockCheck.hasStock) {
        toast.error('Some items are out of stock');
        // Refresh products to get latest stock levels
        await fetchProducts();
        return;
      }

      // Calculate change for cash/split payments
      let changeGiven = 0;
      let cashTendered = 0;
      if (paymentMethod === 'cash' && cashReceived) {
        cashTendered = parseFloat(cashReceived);
        changeGiven = Math.round((cashTendered - total) * 100) / 100; // Round to 2 decimals
      } else if (paymentMethod === 'split' && cashReceived) {
        // For split: change only from cash portion (cashReceived - cardAmount)
        cashTendered = parseFloat(cashReceived);
        const calculatedCardAmount = total - cashTendered;
        changeGiven = 0; // No change for split payments (exact split)
      }

      const userId = (await supabase.auth.getUser()).data.user?.id;
      const saleItems = cart.map(item => ({
        product_id: item.id,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.price * item.quantity
      }));

      let sale;

      // For cash/split payments: use atomic RPC function
      if (paymentMethod === 'cash' || paymentMethod === 'split') {
        const { data: rpcResult, error: rpcError } = await supabase.rpc('complete_cash_sale', {
          p_user_id: userId,
          p_customer_id: selectedCustomer?.id || null,
          p_subtotal: subtotal,
          p_tax: tax,
          p_shipping: shippingCost,
          p_total: total,
          p_payment_method: paymentMethod,
          p_cash_tendered: cashTendered || null,
          p_change_given: changeGiven || null,
          p_sale_items: saleItems
        });

        if (rpcError) throw rpcError;

        // Extract sale_id from RPC response
        const saleId = rpcResult?.sale_id;
        if (!saleId) throw new Error('Failed to create sale - no sale ID returned');

        // Fetch the created sale with related data
        const { data: fetchedSale, error: fetchError } = await supabase
          .from('sales')
          .select('*')
          .eq('id', saleId)
          .single();

        if (fetchError) throw fetchError;
        sale = fetchedSale;

        // Update local auth store with new cash balance
        if (changeGiven > 0 && user?.id) {
          const newCashBalance = (user.cash_on_hand || 0) - changeGiven;
          useAuthStore.getState().updateCashOnHand(newCashBalance);
        }
      } else {
        // For card payments: use existing three-step process
        const { data: cardSale, error: saleError } = await supabase
          .from('sales')
          .insert([{
            user_id: userId,
            customer_id: selectedCustomer?.id || null,
            subtotal,
            tax,
            shipping: shippingCost,
            total,
            payment_method: paymentMethod,
            payment_status: 'completed',
            cash_tendered: null,
            change_given: null
          }])
          .select()
          .single();

        if (saleError) throw saleError;
        sale = cardSale;

        // Insert sale items - the database trigger will handle stock reduction
        const { error: itemsError } = await supabase
          .from('sale_items')
          .insert(saleItems.map(item => ({
            sale_id: sale.id,
            ...item
          })));

        if (itemsError) throw itemsError;
      }

      // If this sale was from a draft order, delete the draft
      if (currentDraftId) {
        const { error: deleteDraftError } = await supabase
          .from('draft_orders')
          .delete()
          .eq('id', currentDraftId);
        
        if (deleteDraftError) {
          console.error('Error deleting draft after sale:', deleteDraftError);
          // Don't throw error - sale was successful, just log the draft deletion issue
        } else {
          console.log('Draft order deleted after successful sale');
        }
      }

      // Fetch complete sale details with items for receipt
      const { data: saleWithUser, error: saleUserError } = await supabase
        .from('sales')
        .select(`
          *,
          user:users(first_name, last_name),
          customer:customers(first_name, last_name, email)
        `)
        .eq('id', sale.id)
        .single();

      if (saleUserError) throw saleUserError;

      const { data: items, error: itemsDetailError } = await supabase
        .from('sale_items')
        .select(`
          *,
          product:products(name, sku)
        `)
        .eq('sale_id', sale.id);

      if (itemsDetailError) throw itemsDetailError;

      // Set completed sale data and show receipt
      setCompletedSale({
        ...saleWithUser,
        items: items || []
      });
      
      toast.success('Sale completed successfully');
      
      // Reset cart and payment state
      setShowPayment(false);
      setCart([]);
      setSelectedCustomer(null);
      setShippingCost(0);
      setPaymentMethod('');
      setCashReceived('');
      setCurrentDraftId(null);
      
      // Show receipt modal
      setShowReceipt(true);
      
      // Refresh products and drafts in background
      fetchProducts();
      fetchDraftOrders();
    } catch (error: any) {
      console.error('Error processing sale:', error);
      toast.error(error.message || 'Failed to process sale');
      isProcessingRef.current = false;  // ✅ Clear ref on error
    } finally {
      // ✅ Always reset both ref and state
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const generateTextReceipt = () => {
    if (!completedSale) return '';

    const storeState = useSettingsStore.getState();
    const settingsData = storeState.settings;
    const lines = 58; // Max characters for 58mm thermal printer
    
    let receipt = '';
    
    // SAFER header values with explicit checks
    const storeSettings = settingsData?.store || {};
    const receiptSettings = settingsData?.receipt || {};
    
    const storeName = storeSettings.name || 'Modern POS';
    const storeAddress = storeSettings.address || '';
    const storePhone = storeSettings.phone || '';
    const receiptHeader = receiptSettings.header || '';
    const receiptFooter = receiptSettings.footer || '';
    
    // Header
    if (storeName) {
      receipt += storeName.substring(0, lines) + '\n';
    }
    if (storeAddress) {
      receipt += storeAddress.substring(0, lines) + '\n';
    }
    if (storePhone) {
      receipt += storePhone.substring(0, lines) + '\n';
    }
    receipt += '-'.repeat(lines) + '\n\n';
    
    // Receipt header from settings
    if (receiptHeader) {
      receipt += receiptHeader.substring(0, lines) + '\n\n';
    }
    
    // Transaction info
    receipt += 'TRANSACTION ID: ' + (completedSale?.id || '') + '\n';
    receipt += 'DATE: ' + formatDate(completedSale?.created_at || new Date().toISOString()) + '\n';
    receipt += 'CASHIER: ' + (completedSale?.user ? `${completedSale.user.first_name} ${completedSale.user.last_name}` : 'Unknown') + '\n';
    receipt += 'CUSTOMER: ' + (completedSale?.customer ? `${completedSale.customer.first_name} ${completedSale.customer.last_name}` : 'Walk-in') + '\n';
    receipt += '-'.repeat(lines) + '\n\n';
    
    // Items header
    const itemHeaderFormat = 'ITEM'.padEnd(30) + 'QTY'.padEnd(8) + 'TOTAL'.padEnd(20);
    receipt += itemHeaderFormat + '\n';
    receipt += '-'.repeat(lines) + '\n';
    
    // Items
    if (completedSale?.items && Array.isArray(completedSale.items)) {
      completedSale.items.forEach((item) => {
        if (item?.product?.name) {
          const price = formatCurrency(item?.subtotal || 0);
          const itemName = item.product.name;
          const itemLine = itemName.substring(0, 30).padEnd(30) + 
                           String(item?.quantity || 0).padEnd(8) + 
                           price.padStart(19) + '\n';
          receipt += itemLine;
        }
      });
    }
    
    receipt += '-'.repeat(lines) + '\n';
    
    // Totals
    const subtotal = formatCurrency(completedSale?.subtotal || 0);
    const tax = formatCurrency(completedSale?.tax || 0);
    const total = formatCurrency(completedSale?.total || 0);
    
    receipt += 'Subtotal'.padEnd(lines - subtotal.length) + subtotal + '\n';
    receipt += 'Tax'.padEnd(lines - tax.length) + tax + '\n';
    
    // Add shipping if applicable
    if (completedSale?.shipping && completedSale.shipping > 0) {
      const shipping = formatCurrency(completedSale.shipping);
      receipt += 'Shipping'.padEnd(lines - shipping.length) + shipping + '\n';
    }
    
    receipt += 'TOTAL'.padEnd(lines - total.length) + total + '\n';
    receipt += '='.repeat(lines) + '\n\n';
    
    // Payment method
    receipt += 'Payment Method: ' + (completedSale?.payment_method?.toUpperCase() || 'UNKNOWN') + '\n';
    receipt += 'Status: ' + (completedSale?.payment_status?.replace('_', ' ').toUpperCase() || 'UNKNOWN') + '\n';
    receipt += '\n' + '-'.repeat(lines) + '\n';
    
    // Footer from settings
    if (receiptFooter) {
      receipt += '\n' + receiptFooter.substring(0, lines) + '\n';
    }
    
    receipt += '\nThank you for your purchase!\n';
    
    return receipt;
  };

  const handleEmailReceipt = async () => {
    if (!completedSale) return;

    try {
      const receiptText = generateTextReceipt();
      if (!receiptText) {
        throw new Error('Failed to generate receipt');
      }
      
      // Create a downloadable text file
      const element = document.createElement('a');
      const file = new Blob([receiptText], { type: 'text/plain' });
      element.href = URL.createObjectURL(file);
      element.download = `receipt-${completedSale.id}.txt`;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);

      toast.success('Receipt downloaded as text file!');
    } catch (error) {
      console.error('Error:', error);
      toast.error('Failed to download receipt');
    }
  };

  const handlePrintReceipt = async () => {
    if (!completedSale) return;

    try {
      const receiptText = generateTextReceipt();
      if (!receiptText) {
        throw new Error('Failed to generate receipt');
      }
      
      // Open in new window and print (works with thermal printer drivers)
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write('<pre style="font-family: monospace; font-size: 12px; white-space: pre-wrap; margin: 0; padding: 10px;">');
        printWindow.document.write(receiptText);
        printWindow.document.write('</pre>');
        printWindow.document.close();
        printWindow.focus();
        
        // Small delay to ensure content is rendered before printing
        setTimeout(() => {
          printWindow.print();
        }, 250);
        
        toast.success('Receipt opened - use Ctrl+P to print');
      }
    } catch (error) {
      console.error('Error:', error);
      toast.error('Failed to print receipt');
    }
  };

  const handleCloseReceipt = () => {
    setShowReceipt(false);
    setCompletedSale(null);
  };

  return (
    <div className="h-full relative">
      {showSaveDraftModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 relative z-[61]">
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
                className="flex-1 px-4 py-3 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveDraftOrder}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {showDraftModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] flex flex-col relative z-[71]">
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
                            {(draft.items as DraftOrderItem[]).length} items • {formatCurrency(draft.total)}
                          </p>
                          <p className="text-xs text-gray-500">
                            {new Date(draft.updated_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => loadDraftOrder(draft)}
                            className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => deleteDraftOrder(draft.id)}
                            className="px-3 py-1 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
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
                  <FolderOpen className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <p>No draft orders</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showCustomerSearch && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl">
            <div className="sticky top-0 bg-white p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">Select Customer</h3>
              <button
                onClick={() => {
                  setShowCustomerSearch(false);
                  setCustomerSearchQuery('');
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors touch-manipulation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search by name, email, or phone..."
                  value={customerSearchQuery}
                  onChange={(e) => setCustomerSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-base border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 touch-manipulation"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingCustomers ? (
                <div className="flex justify-center items-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                </div>
              ) : customers.length > 0 ? (
                <div className="space-y-2">
                  {customers.map((customer) => (
                    <button
                      key={customer.id}
                      onClick={() => handleSelectCustomer(customer)}
                      className="w-full p-4 border-2 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all text-left touch-manipulation active:scale-98"
                    >
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-blue-600 font-semibold text-lg">
                            {customer.first_name[0]}{customer.last_name[0]}
                          </span>
                        </div>
                        <div className="ml-4 flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 truncate">
                            {customer.first_name} {customer.last_name}
                          </p>
                          {customer.email && (
                            <p className="text-sm text-gray-600 truncate">{customer.email}</p>
                          )}
                          {customer.phone && (
                            <p className="text-sm text-gray-500">{customer.phone}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <UserPlus className="h-16 w-16 mb-4 text-gray-400" />
                  <p className="text-lg font-medium">No customers found</p>
                  <p className="text-sm text-center mt-2">
                    {customerSearchQuery.trim() 
                      ? 'Try a different search term' 
                      : 'Add customers from the Customers page'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile: Single column layout with floating cart button */}
      <div className="lg:hidden flex flex-col h-full">
        {/* Product grid takes full space */}
        <div className="flex-1 bg-white rounded-lg shadow overflow-hidden mb-20">
          <div className="p-3 border-b sticky top-0 bg-white z-10">
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-base border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 touch-manipulation"
                />
              </div>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-4 py-3 text-base border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 touch-manipulation"
              >
                <option value="all">All Categories</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              {/* Customer section on product page - Hidden for customer role */}
              {!isCustomerRole && (
                <>
                  {selectedCustomer ? (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-blue-900 text-sm truncate">
                          {selectedCustomer.first_name} {selectedCustomer.last_name}
                        </p>
                        <p className="text-xs text-blue-700 truncate">{selectedCustomer.email}</p>
                      </div>
                      <button
                        onClick={() => setSelectedCustomer(null)}
                        className="ml-2 p-2 hover:bg-blue-100 rounded-lg transition-colors touch-manipulation flex-shrink-0"
                      >
                        <X className="h-5 w-5 text-blue-600" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCustomerSearch(true)}
                      className="w-full p-3 border-2 border-dashed border-gray-300 rounded-xl text-blue-600 font-medium flex items-center justify-center touch-manipulation active:scale-98 transition-transform"
                    >
                      <UserPlus className="h-5 w-5 mr-2" />
                      Add Customer (Optional)
                    </button>
                  )}
                  
                  {/* Load Draft Button - Mobile */}
                  <button
                    onClick={() => setShowDraftModal(true)}
                    className="w-full p-3 border-2 border-blue-500 rounded-xl text-blue-600 font-medium flex items-center justify-center touch-manipulation active:scale-98 transition-transform hover:bg-blue-50"
                  >
                    <FolderOpen className="h-5 w-5 mr-2" />
                    Load Draft Order
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="p-3 grid grid-cols-2 gap-3 overflow-y-auto">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="animate-pulse">
                  <div className="aspect-square bg-gray-200 rounded-xl mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded mb-1"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                </div>
              ))
            ) : filteredProducts.length > 0 ? (
              filteredProducts.map(product => (
                <button
                  key={product.id}
                  onClick={() => handleAddToCart(product)}
                  className="p-3 border-2 rounded-xl active:scale-95 transition-all text-left touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={product.stock_quantity === 0}
                >
                  <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg mb-2 flex items-center justify-center">
                    <Package className="h-10 w-10 text-gray-400" />
                  </div>
                  <h3 className="font-semibold text-sm line-clamp-2 min-h-[2.5rem] break-words">{product.name}</h3>
                  {!isCustomerRole && (
                    <p className="text-xs text-gray-600 font-medium mt-1">
                      {formatCurrency(product.price)}
                    </p>
                  )}
                  {canViewQuantities ? (
                    <p className="text-xs text-gray-500">Stock: {product.stock_quantity}</p>
                  ) : (
                    <p className="text-xs">
                      {product.stock_quantity > 0 ? (
                        <span className="text-green-600 font-medium">In Stock</span>
                      ) : (
                        <span className="text-red-600 font-medium">Out of Stock</span>
                      )}
                    </p>
                  )}
                </button>
              ))
            ) : (
              <div className="col-span-2 flex flex-col items-center justify-center text-gray-500 py-16">
                <Package className="h-16 w-16 mb-4" />
                <p className="text-lg font-medium">No products found</p>
                <p className="text-sm">Try a different search term</p>
              </div>
            )}
          </div>
        </div>

        {/* Floating cart button */}
        {cart.length > 0 && !showPayment && (
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-100 via-gray-100 to-transparent pointer-events-none">
            <button
              onClick={() => setShowPayment(true)}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white py-4 rounded-xl shadow-lg flex items-center justify-between px-6 pointer-events-auto active:scale-98 transition-transform touch-manipulation"
            >
              <div className="flex items-center">
                <div className="bg-white/20 rounded-full px-3 py-1 mr-3">
                  <span className="font-bold">{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
                </div>
                <span className="font-semibold">View Cart</span>
              </div>
              <span className="font-bold text-lg">{formatCurrency(total)}</span>
            </button>
          </div>
        )}

        {/* Mobile Cart/Payment Modal */}
        {showPayment && (
          <div className="fixed inset-0 bg-white z-50 flex flex-col max-h-screen">
            <div className="flex-shrink-0 bg-white border-b shadow-sm z-10">
              <div className="p-4 flex items-center">
                <button
                  onClick={() => setShowPayment(false)}
                  className="mr-4 p-2 hover:bg-gray-100 rounded-lg transition-colors touch-manipulation"
                >
                  <ArrowLeft className="h-6 w-6" />
                </button>
                <h2 className="text-lg font-semibold">
                  {paymentMethod ? 'Payment' : 'Your Cart'}
                </h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 min-h-0">
              {!paymentMethod ? (
                <>
                  {/* Cart items */}
                  <div className="space-y-3 mb-6 pb-2">
                    {cart.map((item) => (
                      <div key={item.id} className="bg-white border rounded-xl p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1 min-w-0 mr-3">
                            <h3 className="font-semibold line-clamp-2 break-words">{item.name}</h3>
                            <p className="text-sm text-gray-600">{formatCurrency(item.price)} each</p>
                          </div>
                          <button
                            onClick={() => setCart(cart.filter(i => i.id !== item.id))}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors touch-manipulation"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center border rounded-lg">
                            <button
                              onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                              className="px-4 py-2 text-lg font-semibold hover:bg-gray-100 touch-manipulation"
                            >
                              −
                            </button>
                            <span className="px-4 py-2 font-semibold min-w-[3rem] text-center">{item.quantity}</span>
                            <button
                              onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                              className="px-4 py-2 text-lg font-semibold hover:bg-gray-100 touch-manipulation"
                              disabled={item.quantity >= item.stock_quantity}
                            >
                              +
                            </button>
                          </div>
                          <span className="font-bold text-lg">{formatCurrency(item.price * item.quantity)}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Shipping cost */}
                  <div className="mb-6 p-4 bg-gray-50 rounded-xl flex-shrink-0">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Shipping Cost (Optional)
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-gray-500">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={shippingCost}
                        onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                        className="w-full pl-8 pr-4 py-3 text-lg border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 touch-manipulation"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  {isCustomerRole && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                      <p className="text-sm text-yellow-800 font-medium">
                        🎓 Training Mode - Save drafts for staff to complete
                      </p>
                    </div>
                  )}

                  {/* Draft buttons */}
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={() => setShowDraftModal(true)}
                      className="flex-1 px-4 py-2 border-2 rounded-lg hover:bg-gray-50 flex items-center justify-center"
                    >
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Load
                    </button>
                    <button
                      onClick={() => setShowSaveDraftModal(true)}
                      disabled={cart.length === 0}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 flex items-center justify-center"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </button>
                  </div>

                  {currentDraftId && (
                    <div className="mb-4 px-3 py-2 bg-yellow-100 text-yellow-800 text-sm rounded-lg text-center">
                      Editing Draft
                    </div>
                  )}

                  {/* Summary */}
                  <div className="bg-gray-50 p-4 rounded-xl space-y-2 mb-4 flex-shrink-0">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Subtotal</span>
                      <span className="font-semibold">{formatCurrency(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Tax ({settings.tax.rate}%)</span>
                      <span className="font-semibold">{formatCurrency(tax)}</span>
                    </div>
                    {shippingCost > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Shipping</span>
                        <span className="font-semibold">{formatCurrency(shippingCost)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold pt-2 border-t">
                      <span>Total</span>
                      <span className="text-blue-600">{formatCurrency(total)}</span>
                    </div>
                  </div>
                </>
              ) : (
                /* Payment methods */
                <div className="space-y-4">
                  <div className="bg-gray-50 p-4 rounded-xl mb-6">
                    <div className="flex justify-between text-xl font-bold">
                      <span>Total Amount</span>
                      <span className="text-blue-600">{formatCurrency(total)}</span>
                    </div>
                  </div>

                  <h3 className="font-semibold text-lg mb-4">Select Payment Method</h3>
                  
                  <button
                    onClick={() => setPaymentMethod('cash')}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    style={{ touchAction: 'manipulation' }}
                    className={`w-full flex items-center p-5 border-2 rounded-xl transition-all touch-manipulation ${
                      paymentMethod === 'cash'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 active:scale-98'
                    }`}
                  >
                    <div className={`p-3 rounded-lg ${paymentMethod === 'cash' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <Banknote className={`h-6 w-6 ${paymentMethod === 'cash' ? 'text-blue-600' : 'text-gray-600'}`} />
                    </div>
                    <span className="ml-4 font-semibold text-lg">Cash</span>
                  </button>

                  <button
                    onClick={() => setPaymentMethod('card')}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    style={{ touchAction: 'manipulation' }}
                    className={`w-full flex items-center p-5 border-2 rounded-xl transition-all touch-manipulation ${
                      paymentMethod === 'card'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 active:scale-98'
                    }`}
                  >
                    <div className={`p-3 rounded-lg ${paymentMethod === 'card' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <CreditCard className={`h-6 w-6 ${paymentMethod === 'card' ? 'text-blue-600' : 'text-gray-600'}`} />
                    </div>
                    <span className="ml-4 font-semibold text-lg">Card</span>
                  </button>

                  <button
                    onClick={() => setPaymentMethod('split')}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    style={{ touchAction: 'manipulation' }}
                    className={`w-full flex items-center p-5 border-2 rounded-xl transition-all touch-manipulation ${
                      paymentMethod === 'split'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 active:scale-98'
                    }`}
                  >
                    <div className={`p-3 rounded-lg ${paymentMethod === 'split' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <Split className={`h-6 w-6 ${paymentMethod === 'split' ? 'text-blue-600' : 'text-gray-600'}`} />
                    </div>
                    <span className="ml-4 font-semibold text-lg">Split Payment</span>
                  </button>

                  {(paymentMethod === 'cash' || paymentMethod === 'split') && (
                    <div className="bg-blue-50 p-4 rounded-xl space-y-3 mt-4 border border-blue-200">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {paymentMethod === 'split' ? 'Cash Amount' : 'Cash Received'}
                        </label>
                        <div className="relative">
                          <span className="absolute left-4 top-3 text-gray-500">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={cashReceived}
                            onChange={(e) => {
                              setCashReceived(e.target.value);
                              if (paymentMethod === 'split' && e.target.value) {
                                const cash = parseFloat(e.target.value);
                                setCardAmount(Math.max(0, total - cash));
                              }
                            }}
                            placeholder="0.00"
                            className="w-full pl-8 pr-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>

                      {paymentMethod === 'split' && cashReceived && (
                        <div className="bg-white p-3 rounded-lg border border-blue-100 space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Cash:</span>
                            <span className="font-semibold text-gray-900">{formatCurrency(parseFloat(cashReceived))}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Card:</span>
                            <span className="font-semibold text-gray-900">{formatCurrency(Math.max(0, total - parseFloat(cashReceived)))}</span>
                          </div>
                          <div className="flex justify-between text-sm border-t pt-2 font-semibold">
                            <span className="text-gray-900">Total:</span>
                            <span className="text-blue-600">{formatCurrency(total)}</span>
                          </div>
                        </div>
                      )}

                      {paymentMethod === 'cash' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Change Due
                          </label>
                          <div className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg bg-white font-semibold text-gray-900">
                            {formatCurrency(cashReceived ? Math.max(0, parseFloat(cashReceived) - total) : 0)}
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Cash in Drawer
                        </label>
                        <div className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg bg-white font-semibold text-gray-900">
                          {formatCurrency(user?.cash_on_hand || 0)}
                        </div>
                      </div>

                      {paymentMethod === 'cash' && cashReceived && parseFloat(cashReceived) < total && (
                        <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                          Cash received must cover the total.
                        </div>
                      )}

                      {paymentMethod === 'split' && cashReceived && parseFloat(cashReceived) >= total && (
                        <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                          ⚠️ For split payment, cash must be less than the total.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex-shrink-0 bg-white border-t p-4 space-y-3 safe-area-bottom">
              {!paymentMethod ? (
                <>
                  {canCompleteSales ? (
                    <button
                      onClick={() => setPaymentMethod('selecting')}
                      disabled={cart.length === 0}
                      className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white py-4 rounded-xl font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation active:scale-98 transition-transform shadow-lg"
                    >
                      Continue to Payment
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowSaveDraftModal(true)}
                      disabled={cart.length === 0}
                      className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white py-4 rounded-xl font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation active:scale-98 transition-transform shadow-lg"
                    >
                      Save as Draft for Staff
                    </button>
                  )}
                  <button
                    onClick={() => setShowPayment(false)}
                    className="w-full border-2 border-blue-500 text-blue-600 py-4 rounded-xl font-semibold touch-manipulation active:scale-98 transition-transform"
                  >
                    <ArrowLeft className="h-5 w-5 inline mr-2" />
                    Back to Products
                  </button>
                  <button
                    onClick={() => {
                      setCart([]);
                      setShippingCost(0);
                      setShowPayment(false);
                    }}
                    disabled={cart.length === 0}
                    className="w-full border-2 border-gray-300 py-4 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation active:scale-98 transition-transform"
                  >
                    Clear Cart
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handlePaymentClick()}
                    disabled={!isValidPaymentMethod || isProcessing || 
                      (paymentMethod === 'cash' && (!cashReceived || parseFloat(cashReceived) < total)) || 
                      (paymentMethod === 'split' && (!cashReceived || parseFloat(cashReceived) <= 0 || parseFloat(cashReceived) >= total))}
                    className="w-full bg-gradient-to-r from-green-600 to-green-500 text-white py-4 rounded-xl font-semibold text-lg touch-manipulation active:scale-98 transition-transform shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {isProcessing ? (
                      <>
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mr-2"></div>
                        Processing...
                      </>
                    ) : (
                      `Complete Payment - ${formatCurrency(total)}`
                    )}
                  </button>
                  <button
                    onClick={() => setPaymentMethod('')}
                    className="w-full border-2 border-gray-300 py-4 rounded-xl font-semibold touch-manipulation active:scale-98 transition-transform"
                  >
                    Back to Cart
                  </button>
                  <button
                    onClick={() => {
                      setShowPayment(false);
                      setPaymentMethod('');
                    }}
                    className="w-full border-2 border-blue-500 text-blue-600 py-3 rounded-xl font-medium touch-manipulation active:scale-98 transition-transform"
                  >
                    Add More Items
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Desktop: Two column layout */}
      <div className="hidden lg:grid grid-cols-12 gap-6 h-[calc(100vh-12rem)]">
        {/* Left side - Product selection */}
        <div className="col-span-12 lg:col-span-8 bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search products by name or SKU..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg"
                  autoFocus
                />
              </div>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-4 py-2 border rounded-lg"
              >
                <option value="all">All Categories</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              {/* Load Draft Button - Desktop */}
              {!isCustomerRole && (
                <button
                  onClick={() => setShowDraftModal(true)}
                  className="px-4 py-2 border-2 border-blue-500 text-blue-600 rounded-lg hover:bg-blue-50 flex items-center whitespace-nowrap font-medium transition-colors"
                >
                  <FolderOpen className="h-5 w-5 mr-2" />
                  Load Draft
                </button>
              )}
            </div>
          </div>

          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 h-[calc(100%-8rem)] overflow-y-auto">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="animate-pulse">
                  <div className="aspect-square bg-gray-200 rounded-lg mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))
            ) : filteredProducts.length > 0 ? (
              filteredProducts.map(product => (
                <button
                  key={product.id}
                  onClick={() => handleAddToCart(product)}
                  className="p-4 border rounded-lg hover:shadow-md transition-shadow text-left"
                  disabled={product.stock_quantity === 0}
                >
                  <div className="aspect-square bg-gray-100 rounded-lg mb-2 flex items-center justify-center text-gray-400">
                    <Package className="h-8 w-8" />
                  </div>
                  <h3 className="font-medium line-clamp-2 min-h-[2.5rem] break-words">{product.name}</h3>
                  {!isCustomerRole ? (
                    <p className="text-sm text-gray-600">
                      {formatCurrency(product.price)} - Stock: {product.stock_quantity}
                    </p>
                  ) : (
                    <p className="text-sm">
                      {product.stock_quantity > 0 ? (
                        <span className="text-green-600 font-medium">In Stock</span>
                      ) : (
                        <span className="text-red-600 font-medium">Out of Stock</span>
                      )}
                    </p>
                  )}
                </button>
              ))
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center text-gray-500 py-12">
                <Package className="h-12 w-12 mb-4" />
                <p className="text-lg">No products found</p>
                <p className="text-sm">Try a different search term</p>
              </div>
            )}
          </div>
        </div>

        {/* Right side - Cart */}
        <div className="col-span-12 lg:col-span-4 bg-white rounded-lg shadow flex flex-col">
          {showPayment ? (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b flex items-center">
                <button
                  onClick={() => setShowPayment(false)}
                  className="mr-4 text-gray-500 hover:text-gray-700"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <h2 className="text-lg font-medium">Payment</h2>
              </div>

              <div className="flex-1 p-4 space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="font-medium">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-600">Tax ({settings.tax.rate}%)</span>
                    <span className="font-medium">{formatCurrency(tax)}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-600">Shipping</span>
                    <span className="font-medium">{formatCurrency(shippingCost)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold pt-2 border-t">
                    <span>Total</span>
                    <span>{formatCurrency(total)}</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-medium text-gray-900">Select Payment Method</h3>
                  <div className="grid grid-cols-1 gap-4">
                    <button
                      onClick={() => setPaymentMethod('cash')}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      style={{ touchAction: 'manipulation' }}
                      className={`flex items-center p-4 border rounded-lg touch-manipulation transition-all ${
                        paymentMethod === 'cash'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-blue-500'
                      }`}
                    >
                      <Banknote className={`h-5 w-5 ${
                        paymentMethod === 'cash' ? 'text-blue-500' : 'text-gray-400'
                      }`} />
                      <span className="ml-3 font-medium">Cash</span>
                    </button>

                    <button
                      onClick={() => setPaymentMethod('card')}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      style={{ touchAction: 'manipulation' }}
                      className={`flex items-center p-4 border rounded-lg touch-manipulation transition-all ${
                        paymentMethod === 'card'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-blue-500'
                      }`}
                    >
                      <CreditCard className={`h-5 w-5 ${
                        paymentMethod === 'card' ? 'text-blue-500' : 'text-gray-400'
                      }`} />
                      <span className="ml-3 font-medium">Card</span>
                    </button>

                    <button
                      onClick={() => setPaymentMethod('split')}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      style={{ touchAction: 'manipulation' }}
                      className={`flex items-center p-4 border rounded-lg touch-manipulation transition-all ${
                        paymentMethod === 'split'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-blue-500'
                      }`}
                    >
                      <Split className={`h-5 w-5 ${
                        paymentMethod === 'split' ? 'text-blue-500' : 'text-gray-400'
                      }`} />
                      <span className="ml-3 font-medium">Split Payment</span>
                    </button>
                  </div>
                </div>

                {/* Cash Input Section for Desktop */}
                {(paymentMethod === 'cash' || paymentMethod === 'split') && (
                  <div className="bg-blue-50 p-4 rounded-lg space-y-3 border border-blue-200">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {paymentMethod === 'split' ? 'Cash Amount' : 'Cash Received'}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-gray-500 font-semibold">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={cashReceived}
                          onChange={(e) => {
                            setCashReceived(e.target.value);
                            if (paymentMethod === 'split' && e.target.value) {
                              const cash = parseFloat(e.target.value);
                              setCardAmount(Math.max(0, total - cash));
                            }
                          }}
                          placeholder="0.00"
                          className="w-full pl-8 pr-4 py-2 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>

                    {paymentMethod === 'split' && cashReceived && (
                      <div className="bg-white p-3 rounded-lg border border-blue-100 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Cash:</span>
                          <span className="font-semibold text-gray-900">{formatCurrency(parseFloat(cashReceived))}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Card:</span>
                          <span className="font-semibold text-gray-900">{formatCurrency(Math.max(0, total - parseFloat(cashReceived)))}</span>
                        </div>
                        <div className="flex justify-between text-sm border-t pt-2 font-semibold">
                          <span className="text-gray-900">Total:</span>
                          <span className="text-blue-600">{formatCurrency(total)}</span>
                        </div>
                      </div>
                    )}

                    {paymentMethod === 'cash' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Change Due
                        </label>
                        <div className="w-full px-4 py-2 text-lg border border-gray-300 rounded-lg bg-white font-semibold text-gray-900">
                          {formatCurrency(cashReceived ? Math.max(0, parseFloat(cashReceived) - total) : 0)}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Cash in Drawer
                      </label>
                      <div className="w-full px-4 py-2 text-lg border border-gray-300 rounded-lg bg-white font-semibold text-gray-900">
                        {formatCurrency(user?.cash_on_hand || 0)}
                      </div>
                    </div>

                    {paymentMethod === 'cash' && cashReceived && parseFloat(cashReceived) < total && (
                      <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                        ⚠️ Cash received must cover the total.
                      </div>
                    )}

                    {paymentMethod === 'split' && cashReceived && parseFloat(cashReceived) >= total && (
                      <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                        ⚠️ For split payment, cash must be less than the total.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-4 border-t space-y-2">
                <button
                  onClick={() => handlePaymentClick()}
                  disabled={!isValidPaymentMethod || isProcessing || 
                    (paymentMethod === 'cash' && (!cashReceived || parseFloat(cashReceived) < total)) || 
                    (paymentMethod === 'split' && (!cashReceived || parseFloat(cashReceived) <= 0 || parseFloat(cashReceived) >= total))}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center touch-manipulation transition-all"
                >
                  {isProcessing ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                      Processing...
                    </>
                  ) : (
                    'Complete Payment'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowPayment(false);
                    setPaymentMethod('');
                  }}
                  className="w-full border border-gray-300 py-2 rounded-lg hover:bg-gray-50"
                >
                  Add More Items
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="p-4 border-b">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-lg font-medium">Current Sale</h2>
                  {!isCustomerRole && (
                    <button
                      onClick={() => setShowCustomerSearch(true)}
                      className="flex items-center text-blue-600 hover:text-blue-700 text-sm"
                    >
                      <UserPlus className="h-4 w-4 mr-1" />
                      <span>{selectedCustomer ? 'Change' : 'Add Customer'}</span>
                    </button>
                  )}
                </div>
                
                {isCustomerRole && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2">
                    <p className="text-xs text-yellow-800 font-medium">
                      🎓 Training Mode
                    </p>
                  </div>
                )}

                {currentDraftId && (
                  <div className="mt-2 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded text-center">
                    Editing Draft
                  </div>
                )}
              </div>

              {!isCustomerRole && selectedCustomer && (
                <div className="p-4 bg-blue-50 border-b">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium text-blue-900">
                        {selectedCustomer.first_name} {selectedCustomer.last_name}
                      </p>
                      <p className="text-sm text-blue-700">{selectedCustomer.email}</p>
                    </div>
                    <button
                      onClick={() => setSelectedCustomer(null)}
                      className="text-blue-600 hover:text-blue-700"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4">
                {cart.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-2">
                    <div className="flex-1">
                <h3 className="font-medium line-clamp-2 break-words">{item.name}</h3>
                <p className="text-sm text-gray-600">{formatCurrency(item.price)}</p>
                {canViewQuantities && (
                  <p className="text-xs text-gray-500">Stock: {item.stock_quantity}</p>
                )}
                    </div>
                    <div className="flex items-center">
                      <input
                        type="number"
                        min="1"
                        max={item.stock_quantity}
                        value={isNaN(item.quantity) ? 1 : item.quantity}
                        onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value))}
                        className="w-16 px-2 py-1 border rounded-lg mr-2"
                      />
                      <button
                        onClick={() => setCart(cart.filter(i => i.id !== item.id))}
                        className="text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 border-t">
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setShowDraftModal(true)}
                    className="flex-1 px-3 py-2 border rounded-lg hover:bg-gray-50 text-sm flex items-center justify-center"
                  >
                    <FolderOpen className="h-4 w-4 mr-1" />
                    Load
                  </button>
                  <button
                    onClick={() => setShowSaveDraftModal(true)}
                    disabled={cart.length === 0}
                    className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 text-sm flex items-center justify-center"
                  >
                    <Save className="h-4 w-4 mr-1" />
                    Save
                  </button>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Tax ({settings.tax.rate}%)</span>
                    <span>{formatCurrency(tax)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Shipping</span>
                    <div className="flex items-center">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={shippingCost}
                        onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                        className="w-20 px-2 py-1 text-right border rounded-md mr-2"
                      />
                      <span>{formatCurrency(shippingCost)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span>{formatCurrency(total)}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {canCompleteSales ? (
                    <button
                      onClick={() => setShowPayment(true)}
                      disabled={cart.length === 0}
                      className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Proceed to Payment
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowSaveDraftModal(true)}
                      disabled={cart.length === 0}
                      className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save as Draft for Staff
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setCart([]);
                      setShippingCost(0);
                    }}
                    disabled={cart.length === 0}
                    className="w-full border border-gray-300 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Clear Cart
                  </button>
                </div>
                
                {/* Desktop info note */}
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-700 text-center">
                    💡 Products are visible on the left. Add items directly from the product grid.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Receipt Modal */}
      {showReceipt && completedSale && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-4xl w-full my-4 sm:my-8 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
            <div className="p-4 sm:p-6 md:p-8">
              <div className="flex justify-between items-start mb-4 sm:mb-6 md:mb-8">
                <div className="flex items-center space-x-2 sm:space-x-3">
                  <Receipt className="h-5 w-5 sm:h-6 sm:w-6 text-green-600" />
                  <h2 className="text-lg sm:text-xl font-semibold text-gray-900">
                    Sale Completed!
                  </h2>
                </div>
                <button
                  onClick={handleCloseReceipt}
                  className="text-gray-400 hover:text-gray-500 transition-colors"
                >
                  <X className="h-5 w-5 sm:h-6 sm:w-6" />
                </button>
              </div>

              <div ref={receiptRef} className="space-y-4 sm:space-y-6 md:space-y-8 bg-white">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
                  <div className="space-y-4 sm:space-y-6">
                    <div>
                      <h3 className="text-xs sm:text-sm font-medium text-gray-500 mb-2">Transaction Info</h3>
                      <div className="space-y-2 sm:space-y-3">
                        <div>
                          <span className="text-xs sm:text-sm text-gray-500">Transaction ID</span>
                          <p className="text-xs sm:text-sm font-medium text-gray-900 break-all">#{completedSale.id}</p>
                        </div>
                        <div>
                          <span className="text-xs sm:text-sm text-gray-500">Date</span>
                          <p className="text-xs sm:text-sm font-medium text-gray-900">
                            {formatDate(completedSale.created_at)}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs sm:text-sm text-gray-500">Payment Method</span>
                          <p className="text-xs sm:text-sm font-medium text-gray-900 capitalize">
                            {completedSale.payment_method}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4 sm:space-y-6">
                    <div>
                      <h3 className="text-xs sm:text-sm font-medium text-gray-500 mb-2">Customer & Staff</h3>
                      <div className="space-y-2 sm:space-y-3">
                        <div>
                          <span className="text-xs sm:text-sm text-gray-500">Customer</span>
                          <p className="text-xs sm:text-sm font-medium text-gray-900">
                            {completedSale.customer
                              ? `${completedSale.customer.first_name} ${completedSale.customer.last_name}`
                              : 'Walk-in Customer'}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs sm:text-sm text-gray-500">Cashier</span>
                          <p className="text-xs sm:text-sm font-medium text-gray-900">
                            {completedSale.user
                              ? `${completedSale.user.first_name} ${completedSale.user.last_name}`
                              : 'Unknown User'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4 sm:pt-6 md:pt-8">
                  <h3 className="text-xs sm:text-sm font-medium text-gray-500 mb-3 sm:mb-4">Items</h3>
                  
                  {/* Mobile-friendly card layout for small screens */}
                  <div className="block sm:hidden space-y-3">
                    {completedSale.items.map((item) => (
                      <div key={item.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">{item.product.name}</p>
                            <p className="text-xs text-gray-500">SKU: {item.product.sku}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500">Qty:</span>
                            <p className="font-medium text-gray-900">{item.quantity}</p>
                          </div>
                          <div>
                            <span className="text-gray-500">Price:</span>
                            <p className="font-medium text-gray-900">{formatCurrency(item.price)}</p>
                          </div>
                          <div>
                            <span className="text-gray-500">Total:</span>
                            <p className="font-medium text-gray-900">{formatCurrency(item.subtotal)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {/* Mobile totals */}
                    <div className="border-t border-gray-200 pt-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Subtotal</span>
                        <span className="text-gray-900">{formatCurrency(completedSale.subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Tax</span>
                        <span className="text-gray-900">{formatCurrency(completedSale.tax)}</span>
                      </div>
                      {completedSale.shipping > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Shipping</span>
                          <span className="text-gray-900">{formatCurrency(completedSale.shipping)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-medium border-t border-gray-200 pt-2">
                        <span className="text-gray-900">Total</span>
                        <span className="text-green-600">{formatCurrency(completedSale.total)}</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Desktop table layout */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Product
                          </th>
                          <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            SKU
                          </th>
                          <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Quantity
                          </th>
                          <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Price
                          </th>
                          <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Subtotal
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {completedSale.items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900">
                              {item.product.name}
                            </td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-500">
                              {item.product.sku}
                            </td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900 text-right">
                              {item.quantity}
                            </td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900 text-right">
                              {formatCurrency(item.price)}
                            </td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900 text-right">
                              {formatCurrency(item.subtotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-500 text-right">
                            Subtotal
                          </td>
                          <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900 text-right">
                            {formatCurrency(completedSale.subtotal)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={4} className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-500 text-right">
                            Tax
                          </td>
                          <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900 text-right">
                            {formatCurrency(completedSale.tax)}
                          </td>
                        </tr>
                        {completedSale.shipping > 0 && (
                          <tr>
                            <td colSpan={4} className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-500 text-right">
                              Shipping
                            </td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900 text-right">
                              {formatCurrency(completedSale.shipping)}
                            </td>
                          </tr>
                        )}
                        <tr className="border-t border-gray-200">
                          <td colSpan={4} className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-gray-900 text-right">
                            Total
                          </td>
                          <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-green-600 text-right">
                            {formatCurrency(completedSale.total)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>

              <div className="mt-4 sm:mt-6 md:mt-8 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-4">
                {completedSale.customer?.email && (
                  <button
                    onClick={handleEmailReceipt}
                    className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                  >
                    <Mail className="h-4 w-4 mr-2" />
                    Email Receipt
                  </button>
                )}
                <button
                  onClick={handlePrintReceipt}
                  className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  <Printer className="h-4 w-4 mr-2" />
                  Print Receipt
                </button>
                <button
                  onClick={handleCloseReceipt}
                  className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
                >
                  Close & Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
