import React from 'react';
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
  isOpen: boolean;
  onClose?: () => void;
}

const navigation = [
  { name: 'Dashboard', icon: LayoutDashboard, path: '/', role: ['admin', 'manager', 'cashier'] },
  { name: 'Point of Sale', icon: ShoppingCart, path: '/pos', role: ['admin', 'manager', 'cashier'] },
  { name: 'Products', icon: Package, path: '/products', role: ['admin', 'manager'] },
  { name: 'Customers', icon: Users, path: '/customers', role: ['admin', 'manager', 'cashier'] },
  { name: 'Purchases', icon: Truck, path: '/purchases', role: ['admin', 'manager'] },
  { name: 'Reports', icon: BarChart, path: '/reports', role: ['admin', 'manager'] },
  { name: 'Transactions', icon: Receipt, path: '/transactions', role: ['admin', 'manager', 'cashier'] },
  { name: 'Staff', icon: UserCircle, path: '/staff', role: ['admin'] },
  { name: 'Settings', icon: Settings, path: '/settings', role: ['admin'] },
];

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user } = useAuthStore();

  return (
    <div className="flex flex-col h-full bg-gray-800">
      <div className="flex items-center justify-between p-4 lg:hidden">
        <div className="flex items-center">
          <ShoppingCart className="h-8 w-8 text-white" />
          <span className="ml-2 text-white text-lg font-semibold">Modern POS</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <X className="h-6 w-6" />
          </button>
        )}
      </div>
      
      <div className="hidden lg:flex items-center p-4">
        <ShoppingCart className="h-8 w-8 text-white" />
        <span className="ml-2 text-white text-lg font-semibold">Modern POS</span>
      </div>
      
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navigation
          .filter((item) => item.role.includes(user?.role as string))
          .map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              onClick={onClose}
              className={({ isActive }) =>
                `group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors
                ${
                  isActive
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`
              }
            >
              <item.icon
                className="mr-3 flex-shrink-0 h-6 w-6"
                aria-hidden="true"
              />
              {item.name}
            </NavLink>
          ))}
      </nav>
    </div>
  );
}