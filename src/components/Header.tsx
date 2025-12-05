import { ReactNode, useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { Bell, Settings, LogOut, ChevronDown } from 'lucide-react';

interface HeaderProps {
  children?: ReactNode;
  onMenuClick?: () => void;
}

export default function Header({ children }: HeaderProps) {
  const { user, signOut } = useAuthStore();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside as any);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside as any);
    };
  }, [showDropdown]);

  const handleSignOut = () => {
    setShowDropdown(false);
    signOut();
  };

  return (
    <header className="bg-white shadow-sm sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center min-w-0">
            {children}
            <h1 className="text-lg sm:text-xl md:text-2xl font-semibold text-gray-900 ml-2 sm:ml-4 truncate">
              Modern POS
            </h1>
          </div>
          
          <div className="flex items-center space-x-2 md:space-x-4">
            <button className="p-2 text-gray-400 hover:text-gray-500 active:text-gray-600 hidden md:block touch-manipulation">
              <Bell className="h-6 w-6" />
            </button>
            <button className="p-2 text-gray-400 hover:text-gray-500 active:text-gray-600 hidden md:block touch-manipulation">
              <Settings className="h-6 w-6" />
            </button>
            
            {/* Mobile dropdown */}
            <div className="relative md:hidden" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center space-x-1 p-2 touch-manipulation active:scale-95 transition-transform"
              >
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                  <span className="text-sm font-medium text-white">
                    {user?.firstName?.[0] || 'U'}{user?.lastName?.[0] || ''}
                  </span>
                </div>
                <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showDropdown && (
                <>
                  <div className="fixed inset-0 z-40 md:hidden" onClick={() => setShowDropdown(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg py-2 z-50 border border-gray-200">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <div className="font-medium text-gray-900">{user?.firstName || ''} {user?.lastName || ''}</div>
                      <div className="text-sm text-gray-500 capitalize">{user?.role || ''}</div>
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="flex items-center w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 touch-manipulation"
                    >
                      <LogOut className="h-4 w-4 mr-3" />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
            
            {/* Desktop user menu */}
            <div className="hidden md:flex items-center space-x-3">
              <div className="flex flex-col items-end">
                <span className="text-sm font-medium text-gray-900">
                  {user?.firstName || ''} {user?.lastName || ''}
                </span>
                <span className="text-xs text-gray-500 capitalize">
                  {user?.role || ''}
                </span>
              </div>
              
              <button
                onClick={handleSignOut}
                className="p-2 text-gray-400 hover:text-gray-500 active:text-gray-600 transition-colors"
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