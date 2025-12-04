import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { hasPermission } from '../utils/permissions';
import { UserRole } from '../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission: 'canAccessPOS' | 'canAccessProducts' | 'canAccessCustomers' | 'canAccessPurchases' | 'canAccessReports' | 'canAccessTransactions' | 'canAccessStaff' | 'canAccessSettings';
}

export default function ProtectedRoute({ children, permission }: ProtectedRouteProps) {
  const { user } = useAuthStore();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!hasPermission(user.role as UserRole, permission)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">You don't have permission to access this page.</p>
          <p className="text-sm text-gray-500 mt-2">Your role: <span className="font-semibold">{user.role}</span></p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
