import { useEffect, useState, useRef, useCallback } from 'react';
import { BarChart3, DollarSign, Package, Users, ShoppingCart } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';

interface DashboardStats {
  totalSales: number;
  productsSold: number;
  activeCustomers: number;
  averageSale: number;
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const [timeRange, setTimeRange] = useState('today');
  const [stats, setStats] = useState<DashboardStats>({
    totalSales: 0,
    productsSold: 0,
    activeCustomers: 0,
    averageSale: 0
  });
  const [loading, setLoading] = useState(true);
  const { formatCurrency } = useSettingsStore();
  
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Check if user is customer role
  const isCustomerRole = user?.role === 'customer';

  useEffect(() => {
    isMountedRef.current = true;
    fetchDashboardStats();
    
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [timeRange]);

  const fetchDashboardStats = useCallback(async () => {
    try {
      // Create new abort controller for this request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      
      if (isMountedRef.current) {
        setLoading(true);
      }

      // Get total sales
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('total')
        .eq('payment_status', 'completed')
        .abortSignal(abortControllerRef.current.signal);

      if (salesError) throw salesError;

      // Get total products sold
      const { data: saleItemsData, error: saleItemsError } = await supabase
        .from('sale_items')
        .select('quantity')
        .abortSignal(abortControllerRef.current.signal);

      if (saleItemsError) throw saleItemsError;

      // Get active customers count
      const { count: customersCount, error: customersError } = await supabase
        .from('customers')
        .select('*', { count: 'exact' })
        .abortSignal(abortControllerRef.current.signal);

      if (customersError) throw customersError;

      // Calculate stats
      const totalSales = salesData?.reduce((sum, sale) => sum + Number(sale.total), 0) || 0;
      const productsSold = saleItemsData?.reduce((sum, item) => sum + item.quantity, 0) || 0;
      const averageSale = salesData?.length ? totalSales / salesData.length : 0;

      if (isMountedRef.current) {
        setStats({
          totalSales,
          productsSold,
          activeCustomers: customersCount || 0,
          averageSale
        });
      }
    } catch (error: any) {
      // Ignore abort errors
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Error fetching dashboard stats:', error);
      if (isMountedRef.current) {
        toast.error('Failed to load dashboard data');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [timeRange]);

  const statCards = [
    { 
      name: 'Total Sales', 
      value: formatCurrency(stats.totalSales), 
      icon: DollarSign,
      loading 
    },
    { 
      name: 'Products Sold', 
      value: stats.productsSold.toString(), 
      icon: Package,
      loading 
    },
    { 
      name: 'Active Customers', 
      value: stats.activeCustomers.toString(), 
      icon: Users,
      loading 
    },
    { 
      name: 'Average Sale', 
      value: formatCurrency(stats.averageSale), 
      icon: BarChart3,
      loading 
    },
  ];

  // Customer role sees a simplified welcome screen
  if (isCustomerRole) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-semibold text-gray-900">Welcome to POS</h1>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg shadow-lg p-8 md:p-12">
          <div className="flex flex-col items-center text-center">
            <div className="bg-blue-100 rounded-full p-6 mb-6">
              <ShoppingCart className="h-16 w-16 text-blue-600" />
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Welcome, {user?.firstName}!
            </h2>
            <p className="text-lg text-gray-700 mb-6 max-w-2xl">
              You're in training mode. Browse products, add items to cart, and create draft orders. 
              A staff member will complete the sale for you.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-3xl mt-8">
              <div className="bg-white rounded-lg p-6 shadow-md">
                <div className="bg-green-100 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-4">
                  <Package className="h-6 w-6 text-green-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Browse Products</h3>
                <p className="text-sm text-gray-600">
                  View available products and check stock status
                </p>
              </div>
              <div className="bg-white rounded-lg p-6 shadow-md">
                <div className="bg-purple-100 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-4">
                  <ShoppingCart className="h-6 w-6 text-purple-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Add to Cart</h3>
                <p className="text-sm text-gray-600">
                  Select items and see prices in your cart
                </p>
              </div>
              <div className="bg-white rounded-lg p-6 shadow-md">
                <div className="bg-orange-100 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-4">
                  <BarChart3 className="h-6 w-6 text-orange-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Save Drafts</h3>
                <p className="text-sm text-gray-600">
                  Create draft orders for staff to complete
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                <strong>Training Mode:</strong> You can browse and add items to cart, but a staff member must complete the final sale.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Regular dashboard for admin, manager, and cashier roles
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <div className="flex space-x-3">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
            <option value="year">This Year</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <div
            key={stat.name}
            className="relative bg-white pt-5 px-4 pb-12 sm:pt-6 sm:px-6 shadow rounded-lg overflow-hidden"
          >
            <dt>
              <div className="absolute bg-blue-500 rounded-md p-3">
                <stat.icon className="h-6 w-6 text-white" aria-hidden="true" />
              </div>
              <p className="ml-16 text-sm font-medium text-gray-500 truncate">
                {stat.name}
              </p>
            </dt>
            <dd className="ml-16 pb-6 flex items-baseline sm:pb-7">
              {stat.loading ? (
                <div className="h-8 w-24 bg-gray-200 animate-pulse rounded"></div>
              ) : (
                <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
              )}
            </dd>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Recent Sales</h2>
          <div className="space-y-3">
            {loading ? (
              <div className="h-64 bg-gray-100 animate-pulse rounded"></div>
            ) : (
              <div className="h-64 bg-gray-50 rounded flex items-center justify-center text-gray-500">
                Sales chart will be implemented soon
              </div>
            )}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Popular Products</h2>
          <div className="space-y-3">
            {loading ? (
              <div className="h-64 bg-gray-100 animate-pulse rounded"></div>
            ) : (
              <div className="h-64 bg-gray-50 rounded flex items-center justify-center text-gray-500">
                Products chart will be implemented soon
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
