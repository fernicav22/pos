import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { X, Receipt, Search, Mail, Printer } from 'lucide-react';

interface Transaction {
  id: string;
  created_at: string;
  total: number;
  subtotal: number;
  tax: number;
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

interface TransactionDetails extends Transaction {
  items: TransactionItem[];
}

interface SearchFilters {
  id: string;
  date: string;
  customer: string;
  cashier: string;
  amount: string;
  payment_method: string;
  status: string;
}

function Transactions() {
  const { formatCurrency } = useSettingsStore();
  const { user } = useAuthStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({
    id: '',
    date: '',
    customer: '',
    cashier: '',
    amount: '',
    payment_method: '',
    status: ''
  });
  const receiptRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Memoize filtered transactions to prevent unnecessary recalculations
  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions];

    if (searchFilters.id) {
      filtered = filtered.filter(t => 
        t.id.toLowerCase().includes(searchFilters.id.toLowerCase())
      );
    }

    if (searchFilters.date) {
      const searchDate = new Date(searchFilters.date);
      filtered = filtered.filter(t => {
        const transactionDate = new Date(t.created_at);
        return transactionDate.toISOString().split('T')[0] === searchDate.toISOString().split('T')[0];
      });
    }

    if (searchFilters.customer) {
      filtered = filtered.filter(t => 
        t.customer
          ? `${t.customer.first_name} ${t.customer.last_name}`
              .toLowerCase()
              .includes(searchFilters.customer.toLowerCase())
          : 'Walk-in Customer'.toLowerCase().includes(searchFilters.customer.toLowerCase())
      );
    }

    if (searchFilters.cashier) {
      filtered = filtered.filter(t => 
        t.user
          ? `${t.user.first_name} ${t.user.last_name}`
              .toLowerCase()
              .includes(searchFilters.cashier.toLowerCase())
          : false
      );
    }

    if (searchFilters.amount) {
      filtered = filtered.filter(t => 
        t.total.toString().includes(searchFilters.amount)
      );
    }

    if (searchFilters.payment_method) {
      filtered = filtered.filter(t => 
        t.payment_method.toLowerCase().includes(searchFilters.payment_method.toLowerCase())
      );
    }

    if (searchFilters.status) {
      filtered = filtered.filter(t => 
        t.payment_status.toLowerCase().includes(searchFilters.status.toLowerCase())
      );
    }

    return filtered;
  }, [transactions, searchFilters]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchTransactions();
    
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [status, startDate]);

  const handleSearchChange = (field: keyof SearchFilters, value: string) => {
    setSearchFilters(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const fetchTransactions = useCallback(async () => {
    try {
      // Create new abort controller for this request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      
      if (isMountedRef.current) {
        setLoading(true);
      }
      
      let query = supabase
        .from('sales')
        .select(`
          *,
          user:users(first_name, last_name),
          customer:customers(first_name, last_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100) // Add pagination limit
        .abortSignal(abortControllerRef.current.signal);

      // If user is cashier, filter to show only their transactions
      if (user?.role === 'cashier') {
        query = query.eq('user_id', user.id);
        
        // Also filter to today's date only
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        query = query
          .gte('created_at', today.toISOString())
          .lt('created_at', tomorrow.toISOString());
      } else {
        // For non-cashier roles, apply the status filter
        if (status !== 'all') {
          query = query.eq('payment_status', status);
        }

        // Apply date filter if provided
        if (startDate) {
          query = query.gte('created_at', startDate);
        }
      }

      const { data, error } = await query;

      if (error) throw error;

      if (isMountedRef.current) {
        setTransactions(data || []);
      }
    } catch (error: any) {
      // Ignore abort errors
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Error fetching transactions:', error);
      if (isMountedRef.current) {
        toast.error('Failed to load transactions');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [status, startDate]);

  const fetchTransactionDetails = async (transactionId: string) => {
    try {
      const { data: transaction, error: transactionError } = await supabase
        .from('sales')
        .select(`
          *,
          user:users(first_name, last_name),
          customer:customers(first_name, last_name)
        `)
        .eq('id', transactionId)
        .single();

      if (transactionError) throw transactionError;

      const { data: items, error: itemsError } = await supabase
        .from('sale_items')
        .select(`
          *,
          product:products(name, sku)
        `)
        .eq('sale_id', transactionId);

      if (itemsError) throw itemsError;

      setSelectedTransaction({
        ...transaction,
        items: items || []
      });
    } catch (error) {
      console.error('Error fetching transaction details:', error);
      toast.error('Failed to load transaction details');
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'refunded':
        return 'bg-red-100 text-red-800';
      case 'partially_refunded':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const generateTextReceipt = () => {
    if (!selectedTransaction) return '';

    const settings = useSettingsStore.getState();
    const lines = 58; // Max characters for 58mm thermal printer
    
    let receipt = '';
    
    // Header
    receipt += settings.store.name.padStart((lines + settings.store.name.length) / 2).padEnd(lines) + '\n';
    receipt += settings.store.address.padStart((lines + settings.store.address.length) / 2).padEnd(lines) + '\n';
    receipt += settings.store.phone.padStart((lines + settings.store.phone.length) / 2).padEnd(lines) + '\n';
    receipt += '-'.repeat(lines) + '\n\n';
    
    // Receipt header from settings
    if (settings.receipt.header) {
      receipt += settings.receipt.header.padStart((lines + settings.receipt.header.length) / 2).padEnd(lines) + '\n\n';
    }
    
    // Transaction info
    receipt += 'TRANSACTION ID: ' + selectedTransaction.id + '\n';
    receipt += 'DATE: ' + formatDate(selectedTransaction.created_at) + '\n';
    receipt += 'CASHIER: ' + (selectedTransaction.user ? `${selectedTransaction.user.first_name} ${selectedTransaction.user.last_name}` : 'Unknown') + '\n';
    receipt += 'CUSTOMER: ' + (selectedTransaction.customer ? `${selectedTransaction.customer.first_name} ${selectedTransaction.customer.last_name}` : 'Walk-in') + '\n';
    receipt += '-'.repeat(lines) + '\n\n';
    
    // Items header
    const itemHeaderFormat = 'ITEM'.padEnd(30) + 'QTY'.padEnd(8) + 'TOTAL'.padEnd(20);
    receipt += itemHeaderFormat + '\n';
    receipt += '-'.repeat(lines) + '\n';
    
    // Items
    selectedTransaction.items.forEach((item) => {
      const price = formatCurrency(item.subtotal);
      const itemLine = item.product.name.substring(0, 30).padEnd(30) + 
                       String(item.quantity).padEnd(8) + 
                       price.padStart(19) + '\n';
      receipt += itemLine;
    });
    
    receipt += '-'.repeat(lines) + '\n';
    
    // Totals
    const subtotal = formatCurrency(selectedTransaction.subtotal);
    const tax = formatCurrency(selectedTransaction.tax);
    const total = formatCurrency(selectedTransaction.total);
    
    receipt += 'Subtotal'.padEnd(lines - subtotal.length) + subtotal + '\n';
    receipt += 'Tax'.padEnd(lines - tax.length) + tax + '\n';
    receipt += 'TOTAL'.padEnd(lines - total.length) + total + '\n';
    receipt += '='.repeat(lines) + '\n\n';
    
    // Payment method
    receipt += 'Payment Method: ' + selectedTransaction.payment_method.toUpperCase() + '\n';
    receipt += 'Status: ' + selectedTransaction.payment_status.replace('_', ' ').toUpperCase() + '\n';
    receipt += '\n' + '-'.repeat(lines) + '\n';
    
    // Footer from settings
    if (settings.receipt.footer) {
      receipt += '\n' + settings.receipt.footer.padStart((lines + settings.receipt.footer.length) / 2).padEnd(lines) + '\n';
    }
    
    receipt += '\nThank you for your purchase!\n';
    
    return receipt;
  };

  const handleEmailReceipt = async () => {
    if (!selectedTransaction) return;

    try {
      const receiptText = generateTextReceipt();
      if (!receiptText) {
        throw new Error('Failed to generate receipt');
      }
      
      const blob = new Blob([receiptText], { type: 'text/plain' });
      
      const formData = new FormData();
      formData.append('text', receiptText);
      formData.append('to', selectedTransaction.customer?.email || '');
      formData.append('transactionId', selectedTransaction.id);

      toast.success('Email sent successfully!');
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error('Failed to send email');
    }
  };

  const handlePrintReceipt = async () => {
    if (!selectedTransaction) return;

    try {
      const receiptText = generateTextReceipt();
      if (!receiptText) {
        throw new Error('Failed to generate receipt');
      }
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        throw new Error('Could not open print window');
      }
      
      printWindow.document.write('<pre style="font-family: monospace; font-size: 10pt;">' + receiptText.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>');
      printWindow.document.close();
      printWindow.print();
    } catch (error) {
      console.error('Error printing:', error);
      toast.error('Failed to print receipt');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
        <h1 className="text-2xl font-semibold text-gray-900">Transactions</h1>
        <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3 w-full sm:w-auto">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="refunded">Refunded</option>
            <option value="partially_refunded">Partially Refunded</option>
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="flex flex-col space-y-3">
                    <span>Transaction ID</span>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search ID..."
                        value={searchFilters.id}
                        onChange={(e) => handleSearchChange('id', e.target.value)}
                        className="pl-9 w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="flex flex-col space-y-2">
                    <span>Date</span>
                    <div className="relative">
                      <input
                        type="date"
                        value={searchFilters.date}
                        onChange={(e) => handleSearchChange('date', e.target.value)}
                        className="w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="flex flex-col space-y-2">
                    <span>Customer</span>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search customer..."
                        value={searchFilters.customer}
                        onChange={(e) => handleSearchChange('customer', e.target.value)}
                        className="pl-8 w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="flex flex-col space-y-2">
                    <span>Cashier</span>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search cashier..."
                        value={searchFilters.cashier}
                        onChange={(e) => handleSearchChange('cashier', e.target.value)}
                        className="pl-8 w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="flex flex-col space-y-2">
                    <span>Amount</span>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search amount..."
                        value={searchFilters.amount}
                        onChange={(e) => handleSearchChange('amount', e.target.value)}
                        className="pl-8 w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="flex flex-col space-y-2">
                    <span>Payment Method</span>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search method..."
                        value={searchFilters.payment_method}
                        onChange={(e) => handleSearchChange('payment_method', e.target.value)}
                        className="pl-8 w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="flex flex-col space-y-2">
                    <span>Status</span>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search status..."
                        value={searchFilters.status}
                        onChange={(e) => handleSearchChange('status', e.target.value)}
                        className="pl-8 w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-4 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    </div>
                  </td>
                </tr>
              ) : filteredTransactions.length > 0 ? (
                filteredTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      #{transaction.id.slice(0, 8)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(transaction.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transaction.customer
                        ? `${transaction.customer.first_name} ${transaction.customer.last_name}`
                        : 'Walk-in Customer'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transaction.user
                        ? `${transaction.user.first_name} ${transaction.user.last_name}`
                        : 'Unknown User'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(transaction.total)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                      {transaction.payment_method}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                          transaction.payment_status
                        )}`}
                      >
                        {transaction.payment_status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => fetchTransactionDetails(transaction.id)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
                    No transactions found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTransaction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-4xl w-full my-4 sm:my-8 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
            <div className="p-4 sm:p-6 md:p-8">
              <div className="flex justify-between items-start mb-4 sm:mb-6 md:mb-8">
                <div className="flex items-center space-x-2 sm:space-x-3">
                  <Receipt className="h-5 w-5 sm:h-6 sm:w-6 text-gray-400" />
                  <h2 className="text-lg sm:text-xl font-semibold text-gray-900">
                    Transaction Details
                  </h2>
                </div>
                <button
                  onClick={() => setSelectedTransaction(null)}
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
                          <p className="text-xs sm:text-sm font-medium text-gray-900 break-all">#{selectedTransaction.id}</p>
                        </div>
                        <div>
                          <span className="text-xs sm:text-sm text-gray-500">Date</span>
                          <p className="text-xs sm:text-sm font-medium text-gray-900">
                            {formatDate(selectedTransaction.created_at)}
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
                            {selectedTransaction.customer
                              ? `${selectedTransaction.customer.first_name} ${selectedTransaction.customer.last_name}`
                              : 'Walk-in Customer'}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs sm:text-sm text-gray-500">Cashier</span>
                          <p className="text-xs sm:text-sm font-medium text-gray-900">
                            {selectedTransaction.user
                              ? `${selectedTransaction.user.first_name} ${selectedTransaction.user.last_name}`
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
                    {selectedTransaction.items.map((item) => (
                      <div key={item.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">{item.product.name}</p>
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
                        <span className="text-gray-900">{formatCurrency(selectedTransaction.subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Tax</span>
                        <span className="text-gray-900">{formatCurrency(selectedTransaction.tax)}</span>
                      </div>
                      <div className="flex justify-between text-base font-medium border-t border-gray-200 pt-2">
                        <span className="text-gray-900">Total</span>
                        <span className="text-gray-900">{formatCurrency(selectedTransaction.total)}</span>
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
                        {selectedTransaction.items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900">
                              {item.product.name}
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
                          <td colSpan={3} className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-500 text-right">
                            Subtotal
                          </td>
                          <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900 text-right">
                            {formatCurrency(selectedTransaction.subtotal)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-500 text-right">
                            Tax
                          </td>
                          <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900 text-right">
                            {formatCurrency(selectedTransaction.tax)}
                          </td>
                        </tr>
                        <tr className="border-t border-gray-200">
                          <td colSpan={3} className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-gray-900 text-right">
                            Total
                          </td>
                          <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-gray-900 text-right">
                            {formatCurrency(selectedTransaction.total)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>

              <div className="mt-4 sm:mt-6 md:mt-8 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-4">
                {selectedTransaction.customer?.email && (
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
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Transactions;
