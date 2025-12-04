import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useSettingsStore } from '../store/settingsStore';
import { BarChart, LineChart, PieChart, TrendingUp, Package, Users, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';

interface SalesSummary {
  totalSales: number;
  totalTransactions: number;
  averageOrderValue: number;
}

interface ProductSummary {
  id: string;
  name: string;
  sku: string;
  quantitySold: number;
  revenue: number;
  stock: number;
}

interface CustomerSummary {
  id: string;
  firstName: string;
  lastName: string;
  totalPurchases: number;
  totalSpent: number;
  lastPurchase: string;
}

export default function Reports() {
  const { formatCurrency } = useSettingsStore();
  const [timeRange, setTimeRange] = useState('7days');
  const [loading, setLoading] = useState(true);
  const [customDateRange, setCustomDateRange] = useState({
    start: '',
    end: ''
  });
  const [salesSummary, setSalesSummary] = useState<SalesSummary>({
    totalSales: 0,
    totalTransactions: 0,
    averageOrderValue: 0
  });
  const [topProducts, setTopProducts] = useState<ProductSummary[]>([]);
  const [topCustomers, setTopCustomers] = useState<CustomerSummary[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<ProductSummary[]>([]);

  useEffect(() => {
    fetchReportData();
  }, [timeRange, customDateRange]);

  const getDateRange = () => {
    const end = new Date();
    let start = new Date();

    switch (timeRange) {
      case 'today':
        start.setHours(0, 0, 0, 0);
        break;
      case '7days':
        start.setDate(start.getDate() - 7);
        break;
      case '30days':
        start.setDate(start.getDate() - 30);
        break;
      case 'custom':
        return {
          start: customDateRange.start,
          end: customDateRange.end
        };
      default:
        start.setDate(start.getDate() - 7);
    }

    return {
      start: start.toISOString(),
      end: end.toISOString()
    };
  };

  const fetchReportData = async () => {
    try {
      setLoading(true);
      const { start, end } = getDateRange();

      // Fetch sales summary
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('total')
        .gte('created_at', start)
        .lte('created_at', end)
        .eq('payment_status', 'completed');

      if (salesError) throw salesError;

      const totalSales = salesData?.reduce((sum, sale) => sum + Number(sale.total), 0) || 0;
      const totalTransactions = salesData?.length || 0;
      const averageOrderValue = totalTransactions > 0 ? totalSales / totalTransactions : 0;

      setSalesSummary({
        totalSales,
        totalTransactions,
        averageOrderValue
      });

      // Fetch top products
      const { data: productsData, error: productsError } = await supabase
        .from('sale_items')
        .select(`
          product_id,
          quantity,
          price,
          product:products(name, sku, stock_quantity)
        `)
        .gte('created_at', start)
        .lte('created_at', end);

      if (productsError) throw productsError;

      const productSummary = productsData.reduce((acc: { [key: string]: ProductSummary }, item) => {
        const productId = item.product_id;
        if (!acc[productId]) {
          acc[productId] = {
            id: productId,
            name: item.product.name,
            sku: item.product.sku,
            quantitySold: 0,
            revenue: 0,
            stock: item.product.stock_quantity
          };
        }
        acc[productId].quantitySold += item.quantity;
        acc[productId].revenue += item.quantity * Number(item.price);
        return acc;
      }, {});

      setTopProducts(
        Object.values(productSummary)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5)
      );

      // Fetch low stock products
      const { data: lowStockData, error: lowStockError } = await supabase
        .from('products')
        .select('*')
        .lt('stock_quantity', 10)
        .order('stock_quantity');

      if (lowStockError) throw lowStockError;

      setLowStockProducts(
        lowStockData.map(product => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          stock: product.stock_quantity,
          quantitySold: 0,
          revenue: 0
        }))
      );

      // Fetch top customers
      const { data: customersData, error: customersError } = await supabase
        .from('sales')
        .select(`
          customer_id,
          total,
          created_at,
          customer:customers(first_name, last_name)
        `)
        .not('customer_id', 'is', null)
        .gte('created_at', start)
        .lte('created_at', end)
        .eq('payment_status', 'completed');

      if (customersError) throw customersError;

      const customerSummary = customersData.reduce((acc: { [key: string]: CustomerSummary }, sale) => {
        const customerId = sale.customer_id;
        if (!acc[customerId]) {
          acc[customerId] = {
            id: customerId,
            firstName: sale.customer.first_name,
            lastName: sale.customer.last_name,
            totalPurchases: 0,
            totalSpent: 0,
            lastPurchase: sale.created_at
          };
        }
        acc[customerId].totalPurchases += 1;
        acc[customerId].totalSpent += Number(sale.total);
        acc[customerId].lastPurchase = new Date(sale.created_at) > new Date(acc[customerId].lastPurchase)
          ? sale.created_at
          : acc[customerId].lastPurchase;
        return acc;
      }, {});

      setTopCustomers(
        Object.values(customerSummary)
          .sort((a, b) => b.totalSpent - a.totalSpent)
          .slice(0, 5)
      );

    } catch (error) {
      console.error('Error fetching report data:', error);
      toast.error('Failed to load report data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Reports</h1>
        <div className="flex items-center space-x-4">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="today">Today</option>
            <option value="7days">Last 7 days</option>
            <option value="30days">Last 30 days</option>
            <option value="custom">Custom Range</option>
          </select>
          
          {timeRange === 'custom' && (
            <div className="flex items-center space-x-2">
              <input
                type="date"
                value={customDateRange.start}
                onChange={(e) => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
              <span>to</span>
              <input
                type="date"
                value={customDateRange.end}
                onChange={(e) => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100 text-blue-600">
              <DollarSign className="h-6 w-6" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Sales</p>
              <h3 className="text-lg font-semibold text-gray-900">
                {loading ? (
                  <div className="h-6 w-24 bg-gray-200 animate-pulse rounded"></div>
                ) : (
                  formatCurrency(salesSummary.totalSales)
                )}
              </h3>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-sm text-gray-500">
              <span>Transactions</span>
              <span>{salesSummary.totalTransactions}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>Avg. Order Value</span>
              <span>{formatCurrency(salesSummary.averageOrderValue)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100 text-green-600">
              <Package className="h-6 w-6" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Top Products</p>
              <h3 className="text-lg font-semibold text-gray-900">
                {loading ? (
                  <div className="h-6 w-24 bg-gray-200 animate-pulse rounded"></div>
                ) : (
                  `${topProducts.length} Products`
                )}
              </h3>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {loading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-4 bg-gray-200 animate-pulse rounded"></div>
                ))}
              </div>
            ) : (
              topProducts.slice(0, 3).map(product => (
                <div key={product.id} className="flex justify-between text-sm">
                  <span className="text-gray-500 truncate">{product.name}</span>
                  <span className="text-gray-900 font-medium">
                    {formatCurrency(product.revenue)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-purple-100 text-purple-600">
              <Users className="h-6 w-6" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Top Customers</p>
              <h3 className="text-lg font-semibold text-gray-900">
                {loading ? (
                  <div className="h-6 w-24 bg-gray-200 animate-pulse rounded"></div>
                ) : (
                  `${topCustomers.length} Customers`
                )}
              </h3>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {loading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-4 bg-gray-200 animate-pulse rounded"></div>
                ))}
              </div>
            ) : (
              topCustomers.slice(0, 3).map(customer => (
                <div key={customer.id} className="flex justify-between text-sm">
                  <span className="text-gray-500 truncate">
                    {`${customer.firstName} ${customer.lastName}`}
                  </span>
                  <span className="text-gray-900 font-medium">
                    {formatCurrency(customer.totalSpent)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Detailed Reports */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products Report */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Top Selling Products</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sold</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={3} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 animate-pulse rounded"></div>
                      </td>
                    </tr>
                  ))
                ) : (
                  topProducts.map(product => (
                    <tr key={product.id}>
                      <td className="px-4 py-3 text-sm text-gray-900">{product.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">{product.quantitySold}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">
                        {formatCurrency(product.revenue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Stock Alert */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Low Stock Alert</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">SKU</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={3} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 animate-pulse rounded"></div>
                      </td>
                    </tr>
                  ))
                ) : (
                  lowStockProducts.map(product => (
                    <tr key={product.id}>
                      <td className="px-4 py-3 text-sm text-gray-900">{product.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 text-right">{product.sku}</td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          product.stock === 0
                            ? 'bg-red-100 text-red-800'
                            : product.stock < 5
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {product.stock}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Customer Analysis */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Top Customers</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Orders</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Spent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={3} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 animate-pulse rounded"></div>
                      </td>
                    </tr>
                  ))
                ) : (
                  topCustomers.map(customer => (
                    <tr key={customer.id}>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {`${customer.firstName} ${customer.lastName}`}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">
                        {customer.totalPurchases}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">
                        {formatCurrency(customer.totalSpent)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sales Trends */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Sales Overview</h2>
          <div className="h-64 flex items-center justify-center bg-gray-50 rounded">
            <div className="text-center text-gray-500">
              <BarChart className="h-8 w-8 mx-auto mb-2" />
              <p>Sales chart visualization coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}