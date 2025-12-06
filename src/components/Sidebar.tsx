import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  BarChart,
  Settings,
  Receipt,
  UserCircle,
  X,
  Truck
} from 'lucide-react';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const navigation = [
  { name: 'Dashboard', icon: LayoutDashboard, path: '/', role: ['admin', 'manager', 'cashier'] },
  { name: 'Point of Sale', icon: ShoppingCart, path: '/pos', role: ['admin', 'manager', 'cashier', 'customer'] },
  { name: 'Products', icon: Package, path: '/products', role: ['admin', 'manager'] },
  { name: 'Customers', icon: Users, path: '/customers', role: ['admin', 'manager', 'cashier'] },
  { name: 'Purchases', icon: Truck, path: '/purchases', role: ['admin', 'manager'] },
  { name: 'Reports', icon: BarChart, path: '/reports', role: ['admin', 'manager'] },
  { name: 'Transactions', icon: Receipt, path: '/transactions', role: ['admin', 'manager', 'cashier'] },
  { name: 'Staff', icon: UserCircle, path: '/staff', role: ['admin'] },
  { name: 'Settings', icon: Settings, path: '/settings', role: ['admin'] },
];

export default function Sidebar({ onClose }: SidebarProps) {
  const { user } = useAuthStore();

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-800 to-gray-900 shadow-xl">
      {/* Mobile header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700 lg:border-0 lg:hidden">
        <div className="flex items-center">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-2 rounded-lg">
            <ShoppingCart className="h-6 w-6 text-white" />
          </div>
          <span className="ml-3 text-white text-lg font-semibold">Modern POS</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-700 active:bg-gray-600 transition-colors touch-manipulation"
            aria-label="Close menu"
          >
            <X className="h-6 w-6" />
          </button>
        )}
      </div>
      
      {/* Desktop header */}
      <div className="hidden lg:flex items-center p-4 border-b border-gray-700">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-2 rounded-lg">
          <ShoppingCart className="h-6 w-6 text-white" />
        </div>
        <span className="ml-3 text-white text-lg font-semibold">Modern POS</span>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overscroll-contain">
        {navigation
          .filter((item) => item.role.includes(user?.role as string))
          .map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              onClick={onClose}
              className={({ isActive }) =>
                `group flex items-center px-3 py-3 text-base font-medium rounded-lg transition-all duration-200 touch-manipulation
                ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg scale-[1.02]'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white active:bg-gray-600'
                }`
              }
            >
              <item.icon
                className="mr-3 flex-shrink-0 h-6 w-6"
                aria-hidden="true"
              />
              <span className="truncate">{item.name}</span>
            </NavLink>
          ))}
      </nav>

      {/* User info footer */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center text-gray-300 text-sm">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-medium text-xs">
            {user?.firstName?.[0] || 'U'}{user?.lastName?.[0] || ''}
          </div>
          <div className="ml-3 min-w-0 flex-1">
            <p className="font-medium text-white truncate">{user?.firstName || ''} {user?.lastName || ''}</p>
            <p className="text-xs text-gray-400 capitalize">{user?.role || ''}</p>
          </div>
        </div>
      </div>
    </div>
  );
}