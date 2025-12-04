import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Search, Filter, Package, X, Calendar, Truck, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import toast from 'react-hot-toast';

interface Supplier {
  id: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock_quantity: number;
}

interface Purchase {
  id: string;
  supplier: Supplier;
  reference_number: string;
  purchase_date: string;
  expected_delivery_date: string;
  delivery_date: string | null;
  subtotal: number;
  tax: number;
  total: number;
  status: 'draft' | 'ordered' | 'received' | 'cancelled';
  payment_status: 'pending' | 'partial' | 'paid';
  created_at: string;
}

interface PurchaseItem {
  id: string;
  product_id: string;
  product: {
    name: string;
    sku: string;
  };
  quantity: number;
  cost_per_unit: number;
  subtotal: number;
  received_quantity: number;
}

interface NewPurchaseFormData {
  supplier_id: string;
  reference_number: string;
  purchase_date: string;
  expected_delivery_date: string;
  tax_rate: number;
  notes: string;
  items: {
    product_id: string;
    quantity: number;
    cost_per_unit: number;
  }[];
}

export default function Purchases() {
  const { user } = useAuthStore();
  const { formatCurrency } = useSettingsStore();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddPurchase, setShowAddPurchase] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [formData, setFormData] = useState<NewPurchaseFormData>({
    supplier_id: '',
    reference_number: '',
    purchase_date: new Date().toISOString().split('T')[0],
    expected_delivery_date: '',
    tax_rate: 10,
    notes: '',
    items: []
  });

  const fetchPurchases = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('purchases')
        .select(`
          *,
          supplier:suppliers(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPurchases(data || []);
    } catch (error) {
      console.error('Error fetching purchases:', error);
      toast.error('Failed to load purchases');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSuppliers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('name');

      if (error) throw error;
      setSuppliers(data || []);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      toast.error('Failed to load suppliers');
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name');

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      toast.error('Failed to load products');
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([
        fetchPurchases(),
        fetchSuppliers(),
        fetchProducts()
      ]);
    };
    loadData();
  }, [fetchPurchases, fetchSuppliers, fetchProducts]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter(purchase => {
      const matchesSearch = searchQuery.toLowerCase().trim() === '' ||
        purchase.reference_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        purchase.supplier.name.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = statusFilter === 'all' || purchase.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [purchases, searchQuery, statusFilter]);

  const calculateSubtotal = useCallback(() => {
    return formData.items.reduce((sum, item) => sum + (item.quantity * item.cost_per_unit), 0);
  }, [formData.items]);

  const calculateTax = useCallback(() => {
    const subtotal = calculateSubtotal();
    return (subtotal * formData.tax_rate) / 100;
  }, [calculateSubtotal, formData.tax_rate]);

  const calculateTotal = useCallback(() => {
    return calculateSubtotal() + calculateTax();
  }, [calculateSubtotal, calculateTax]);

  const handleAddItem = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { product_id: '', quantity: 1, cost_per_unit: 0 }]
    }));
  }, []);

  const handleRemoveItem = useCallback((index: number) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  }, []);

  const handleItemChange = useCallback((index: number, field: string, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => {
        if (i === index) {
          return { ...item, [field]: value };
        }
        return item;
      })
    }));
  }, []);

  const fetchPurchaseItems = async (purchaseId: string) => {
    try {
      const { data, error } = await supabase
        .from('purchase_items')
        .select(`
          *,
          product:products(name, sku)
        `)
        .eq('purchase_id', purchaseId);

      if (error) throw error;
      setPurchaseItems(data || []);
    } catch (error) {
      console.error('Error fetching purchase items:', error);
      toast.error('Failed to load purchase items');
    }
  };

  const handleReceivePurchase = async (purchase: Purchase) => {
    try {
      const { error } = await supabase
        .from('purchases')
        .update({
          status: 'received',
          delivery_date: new Date().toISOString()
        })
        .eq('id', purchase.id);

      if (error) throw error;

      toast.success('Purchase received successfully');
      fetchPurchases();
    } catch (error) {
      console.error('Error receiving purchase:', error);
      toast.error('Failed to receive purchase');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (!user) throw new Error('User not authenticated');
      if (formData.items.length === 0) throw new Error('Please add at least one item');

      const subtotal = calculateSubtotal();
      const tax = calculateTax();
      const total = calculateTotal();

      const { data: purchase, error: purchaseError } = await supabase
        .from('purchases')
        .insert([{
          supplier_id: formData.supplier_id,
          user_id: user.id,
          reference_number: formData.reference_number,
          purchase_date: formData.purchase_date,
          expected_delivery_date: formData.expected_delivery_date || null,
          subtotal,
          tax,
          total,
          status: 'ordered',
          notes: formData.notes
        }])
        .select()
        .single();

      if (purchaseError) throw purchaseError;

      const { error: itemsError } = await supabase
        .from('purchase_items')
        .insert(
          formData.items.map(item => ({
            purchase_id: purchase.id,
            product_id: item.product_id,
            quantity: item.quantity,
            cost_per_unit: item.cost_per_unit,
            subtotal: item.quantity * item.cost_per_unit
          }))
        );

      if (itemsError) throw itemsError;

      toast.success('Purchase order created successfully');
      setShowAddPurchase(false);
      setFormData({
        supplier_id: '',
        reference_number: '',
        purchase_date: new Date().toISOString().split('T')[0],
        expected_delivery_date: '',
        tax_rate: 10,
        notes: '',
        items: []
      });
      fetchPurchases();
    } catch (error: any) {
      console.error('Error creating purchase:', error);
      toast.error(error.message || 'Failed to create purchase');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'received':
        return 'bg-green-100 text-green-800';
      case 'ordered':
        return 'bg-blue-100 text-blue-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'partial':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <p className="text-red-600">
          You need admin or manager permissions to access purchases
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Supplier Purchases</h1>
        <button
          onClick={() => setShowAddPurchase(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Purchase
        </button>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search purchases..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="ordered">Ordered</option>
              <option value="received">Received</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reference
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Supplier
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Payment
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    </div>
                  </td>
                </tr>
              ) : filteredPurchases.length > 0 ? (
                filteredPurchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {purchase.reference_number || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {purchase.supplier.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(purchase.purchase_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(purchase.total)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                          purchase.status
                        )}`}
                      >
                        {purchase.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getPaymentStatusColor(
                          purchase.payment_status
                        )}`}
                      >
                        {purchase.payment_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => {
                          setSelectedPurchase(purchase);
                          fetchPurchaseItems(purchase.id);
                        }}
                        className="text-blue-600 hover:text-blue-900 mr-4"
                      >
                        View
                      </button>
                      {purchase.status === 'ordered' && (
                        <button
                          onClick={() => handleReceivePurchase(purchase)}
                          className="text-green-600 hover:text-green-900"
                        >
                          Receive
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    No purchases found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Purchase Modal */}
      {showAddPurchase && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleSubmit} className="p-6">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-xl font-semibold text-gray-900">New Purchase Order</h2>
                <button
                  type="button"
                  onClick={() => setShowAddPurchase(false)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Supplier
                    </label>
                    <select
                      value={formData.supplier_id}
                      onChange={(e) => setFormData(prev => ({ ...prev, supplier_id: e.target.value }))}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      required
                    >
                      <option value="">Select Supplier</option>
                      {suppliers.map(supplier => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Reference Number
                    </label>
                    <input
                      type="text"
                      value={formData.reference_number}
                      onChange={(e) => setFormData(prev => ({ ...prev, reference_number: e.target.value }))}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="PO-0001"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Purchase Date
                    </label>
                    <input
                      type="date"
                      value={formData.purchase_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, purchase_date: e.target.value }))}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Expected Delivery Date
                    </label>
                    <input
                      type="date"
                      value={formData.expected_delivery_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, expected_delivery_date: e.target.value }))}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-gray-900">Items</h3>
                    <button
                      type="button"
                      onClick={handleAddItem}
                      className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Item
                    </button>
                  </div>

                  <div className="space-y-4">
                    {formData.items.map((item, index) => (
                      <div key={index} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <select
                            value={item.product_id}
                            onChange={(e) => handleItemChange(index, 'product_id', e.target.value)}
                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            required
                          >
                            <option value="">Select Product</option>
                            {products.map(product => (
                              <option key={product.id} value={product.id}>
                                {product.name} ({product.sku})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="w-24">
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleItemChange(index, 'quantity', parseInt(e.target.value))}
                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            placeholder="Qty"
                            required
                          />
                        </div>
                        <div className="w-32">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.cost_per_unit}
                            onChange={(e) => handleItemChange(index, 'cost_per_unit', parseFloat(e.target.value))}
                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            placeholder="Cost"
                            required
                          />
                        </div>
                        <div className="w-32 text-right font-medium">
                          {formatCurrency(item.quantity * item.cost_per_unit)}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(index)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Tax Rate (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={formData.tax_rate}
                      onChange={(e) => setFormData(prev => ({ ...prev, tax_rate: parseFloat(e.target.value) }))}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Notes
                    </label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                      rows={3}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <div className="flex justify-end space-y-2">
                    <div className="text-right">
                      <div className="text-sm text-gray-500">
                        Subtotal: {formatCurrency(calculateSubtotal())}
                      </div>
                      <div className="text-sm text-gray-500">
                        Tax ({formData.tax_rate}%): {formatCurrency(calculateTax())}
                      </div>
                      <div className="text-lg font-medium text-gray-900">
                        Total: {formatCurrency(calculateTotal())}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowAddPurchase(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                  >
                    Create Purchase Order
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Purchase Details Modal */}
      {selectedPurchase && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    Purchase Details
                  </h2>
                  <p className="text-sm text-gray-500">
                    Reference: {selectedPurchase.reference_number || '-'}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedPurchase(null)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">Supplier</h3>
                  <p className="text-sm text-gray-900">{selectedPurchase.supplier.name}</p>
                  <p className="text-sm text-gray-500">{selectedPurchase.supplier.email}</p>
                  <p className="text-sm text-gray-500">{selectedPurchase.supplier.phone}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">Dates</h3>
                  <div className="space-y-1">
                    <p className="text-sm text-gray-900">
                      <Calendar className="h-4 w-4 inline mr-2" />
                      Purchase Date: {new Date(selectedPurchase.purchase_date).toLocaleDateString()}
                    </p>
                    {selectedPurchase.expected_delivery_date && (
                      <p className="text-sm text-gray-900">
                        <Truck className="h-4 w-4 inline mr-2" />
                        Expected Delivery: {new Date(selectedPurchase.expected_delivery_date).toLocaleDateString()}
                      </p>
                    )}
                    {selectedPurchase.delivery_date && (
                      <p className="text-sm text-gray-900">
                        <Package className="h-4 w-4 inline mr-2" />
                        Delivered: {new Date(selectedPurchase.delivery_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-sm font-medium text-gray-500 mb-4">Items</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Product
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          SKU
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Quantity
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Cost
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Subtotal
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {purchaseItems.map((item) => (
                        <tr key={item.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.product.name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {item.product.sku}
                          </td>
                          <td className="px-6  py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                            {item.quantity}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                            {formatCurrency(item.cost_per_unit)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                            {formatCurrency(item.subtotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="px-6 py-4 text-sm text-gray-500 text-right">
                          Subtotal
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {formatCurrency(selectedPurchase.subtotal)}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={4} className="px-6 py-4 text-sm text-gray-500 text-right">
                          Tax
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {formatCurrency(selectedPurchase.tax)}
                        </td>
                      </tr>
                      <tr className="border-t border-gray-200">
                        <td colSpan={4} className="px-6 py-4 text-sm font-medium text-gray-900 text-right">
                          Total
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                          {formatCurrency(selectedPurchase.total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}