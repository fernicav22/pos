import React, { ReactNode, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { Bell, Settings, LogOut, ChevronDown } from 'lucide-react';

interface HeaderProps {
  children?: ReactNode;
  onMenuClick?: () => void;
}

export default function Header({ children, onMenuClick }: HeaderProps) {
  const { user, signOut } = useAuthStore();
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            {children}
            <h1 className="text-xl md:text-2xl font-semibold text-gray-900 ml-4">
              Modern POS
            </h1>
          </div>
          
          <div className="flex items-center space-x-2 md:space-x-4">
            <button className="p-2 text-gray-400 hover:text-gray-500 hidden md:block">
              <Bell className="h-6 w-6" />
            </button>
            <button className="p-2 text-gray-400 hover:text-gray-500 hidden md:block">
              <Settings className="h-6 w-6" />
            </button>
            
            {/* Mobile dropdown */}
            <div className="relative md:hidden">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center space-x-1 p-2"
              >
                <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center">
                  <span className="text-sm font-medium text-gray-600">
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </span>
                </div>
                <ChevronDown className="h-4 w-4 text-gray-500" />
              </button>

              {showDropdown && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50">
                  <div className="px-4 py-2 text-sm text-gray-700">
                    <div className="font-medium">{user?.firstName} {user?.lastName}</div>
                    <div className="text-gray-500 capitalize">{user?.role}</div>
                  </div>
                  <div className="border-t border-gray-100"></div>
                  <button
                    onClick={() => signOut()}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
            
            {/* Desktop user menu */}
            <div className="hidden md:flex items-center space-x-3">
              <div className="flex flex-col items-end">
                <span className="text-sm font-medium text-gray-900">
                  {user?.firstName} {user?.lastName}
                </span>
                <span className="text-xs text-gray-500 capitalize">
                  {user?.role}
                </span>
              </div>
              
              <button
                onClick={() => signOut()}
                className="p-2 text-gray-400 hover:text-gray-500"
              >
                <LogOut className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}