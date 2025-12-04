import React, { useEffect, useState } from 'react';
import { BarChart3, DollarSign, Package, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useSettingsStore } from '../store/settingsStore';

interface DashboardStats {
  totalSales: number;
  productsSold: number;
  activeCustomers: number;
  averageSale: number;
}

export default function Dashboard() {
  const [timeRange, setTimeRange] = useState('today');
  const [stats, setStats] = useState<DashboardStats>({
    totalSales: 0,
    productsSold: 0,
    activeCustomers: 0,
    averageSale: 0
  });
  const [loading, setLoading] = useState(true);
  const { formatCurrency } = useSettingsStore();

  useEffect(() => {
    fetchDashboardStats();
  }, [timeRange]);

  const fetchDashboardStats = async () => {
    try {
      setLoading(true);

      // Get total sales
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('total')
        .eq('payment_status', 'completed');

      if (salesError) throw salesError;

      // Get total products sold
      const { data: saleItemsData, error: saleItemsError } = await supabase
        .from('sale_items')
        .select('quantity');

      if (saleItemsError) throw saleItemsError;

      // Get active customers count
      const { count: customersCount, error: customersError } = await supabase
        .from('customers')
        .select('*', { count: 'exact' });

      if (customersError) throw customersError;

      // Calculate stats
      const totalSales = salesData?.reduce((sum, sale) => sum + Number(sale.total), 0) || 0;
      const productsSold = saleItemsData?.reduce((sum, item) => sum + item.quantity, 0) || 0;
      const averageSale = salesData?.length ? totalSales / salesData.length : 0;

      setStats({
        totalSales,
        productsSold,
        activeCustomers: customersCount || 0,
        averageSale
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

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