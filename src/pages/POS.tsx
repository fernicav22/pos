import React, { useState, useEffect } from 'react';
import { Search, CreditCard, Banknote, Wallet, Receipt, UserPlus, Split, ArrowLeft, Package, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { Product } from '../types';
import { checkStock } from '../utils/inventory';
import { useSettingsStore } from '../store/settingsStore';

interface CartItem extends Product {
  quantity: number;
}

interface CustomerFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export default function POS() {
  const { settings, formatCurrency, calculateTax } = useSettingsStore();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [showPayment, setShowPayment] = useState(false);
  const [splitPayment, setSplitPayment] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [shippingCost, setShippingCost] = useState(0);
  const [customerFormData, setCustomerFormData] = useState<CustomerFormData>({
    firstName: '',
    lastName: '',
    email: '',
    phone: ''
  });
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [filteredCustomers, setFilteredCustomers] = useState<any[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, []);

  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = products.filter(product => 
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.sku.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredProducts(filtered);
    } else {
      setFilteredProducts(products);
    }
  }, [searchQuery, products]);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .gt('stock_quantity', 0)
        .order('name');

      if (error) throw error;

      setProducts(data || []);
      setFilteredProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      toast.error('Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .order('name');

      if (error) throw error;

      setCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
      toast.error('Failed to load categories');
    }
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

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = calculateTax(subtotal);
  const total = subtotal + tax + shippingCost;

  const handlePayment = async () => {
    try {
      if (!paymentMethod) {
        toast.error('Please select a payment method');
        return;
      }

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

      // Create the sale
      const { data: sale, error: saleError } = await supabase
        .from('sales')
        .insert([{
          user_id: (await supabase.auth.getUser()).data.user?.id,
          customer_id: selectedCustomer?.id || null,
          subtotal,
          tax,
          shipping: shippingCost,
          total,
          payment_method: paymentMethod,
          payment_status: 'completed'
        }])
        .select()
        .single();

      if (saleError) throw saleError;

      const saleItems = cart.map(item => ({
        sale_id: sale.id,
        product_id: item.id,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.price * item.quantity
      }));

      // Insert sale items - the database trigger will handle stock reduction
      const { error: itemsError } = await supabase
        .from('sale_items')
        .insert(saleItems);

      if (itemsError) throw itemsError;

      toast.success('Sale completed successfully');
      setShowPayment(false);
      setCart([]);
      setSelectedCustomer(null);
      setShippingCost(0);
      setPaymentMethod('');
      setSplitPayment(false);
      fetchProducts(); // Refresh products to show updated stock levels
    } catch (error: any) {
      console.error('Error processing sale:', error);
      toast.error(error.message || 'Failed to process sale');
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { data: customer, error } = await supabase
        .from('customers')
        .insert([{
          first_name: customerFormData.firstName,
          last_name: customerFormData.lastName,
          email: customerFormData.email || null,
          phone: customerFormData.phone || null
        }])
        .select()
        .single();

      if (error) throw error;

      toast.success('Customer created successfully');
      setSelectedCustomer(customer);
      setShowNewCustomerForm(false);
      setShowCustomerSearch(false);
      setCustomerFormData({
        firstName: '',
        lastName: '',
        email: '',
        phone: ''
      });
    } catch (error: any) {
      console.error('Error creating customer:', error);
      toast.error(error.message || 'Failed to create customer');
    }
  };

  const handleCustomerFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCustomerFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  return (
    <div className="h-full">
      {showCustomerSearch && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          {/* ... (keep modal content) */}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6 h-[calc(100vh-12rem)]">
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
            </div>
          </div>

          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 h-[calc(100%-8rem)] overflow-y-auto">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse">
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
                  <h3 className="font-medium truncate">{product.name}</h3>
                  <p className="text-sm text-gray-600">
                    {formatCurrency(product.price)} - Stock: {product.stock_quantity}
                  </p>
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
                      className={`flex items-center p-4 border rounded-lg ${
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
                      className={`flex items-center p-4 border rounded-lg ${
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
                      onClick={() => {
                        setPaymentMethod('split');
                        setSplitPayment(true);
                      }}
                      className={`flex items-center p-4 border rounded-lg ${
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
              </div>

              <div className="p-4 border-t">
                <button
                  onClick={handlePayment}
                  disabled={!paymentMethod}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Complete Payment
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="p-4 border-b flex justify-between items-center">
                <h2 className="text-lg font-medium">Current Sale</h2>
                <button
                  onClick={() => setShowCustomerSearch(true)}
                  className="flex items-center text-blue-600 hover:text-blue-700"
                >
                  <UserPlus className="h-5 w-5 mr-1" />
                  <span>{selectedCustomer ? 'Change Customer' : 'Add Customer'}</span>
                </button>
              </div>

              {selectedCustomer && (
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
                      <h3 className="font-medium">{item.name}</h3>
                      <p className="text-sm text-gray-600">{formatCurrency(item.price)}</p>
                    </div>
                    <div className="flex items-center">
                      <input
                        type="number"
                        min="1"
                        max={item.stock_quantity}
                        value={item.quantity}
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
                  <button
                    onClick={() => setShowPayment(true)}
                    disabled={cart.length === 0}
                    className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Proceed to Payment
                  </button>
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
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}