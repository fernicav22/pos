import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Products from './pages/Products';
import Customers from './pages/Customers';
import Reports from './pages/Reports';
import Transactions from './pages/Transactions';
import Staff from './pages/Staff';
import Settings from './pages/Settings';
import Purchases from './pages/Purchases';
import { useAuthStore } from './store/authStore';
import { useSettingsStore } from './store/settingsStore';

function App() {
  const { loading: authLoading, user } = useAuthStore();
  const { loadSettings, isInitialized } = useSettingsStore();

  // Load settings from database after user is authenticated
  useEffect(() => {
    if (user) {
      loadSettings();
    }
  }, [user, loadSettings]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If user is logged in, wait for settings to initialize
  if (user && !isInitialized) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="pos" element={
            <ProtectedRoute permission="canAccessPOS">
              <POS />
            </ProtectedRoute>
          } />
          <Route path="products" element={
            <ProtectedRoute permission="canAccessProducts">
              <Products />
            </ProtectedRoute>
          } />
          <Route path="customers" element={
            <ProtectedRoute permission="canAccessCustomers">
              <Customers />
            </ProtectedRoute>
          } />
          <Route path="purchases" element={
            <ProtectedRoute permission="canAccessPurchases">
              <Purchases />
            </ProtectedRoute>
          } />
          <Route path="reports" element={
            <ProtectedRoute permission="canAccessReports">
              <Reports />
            </ProtectedRoute>
          } />
          <Route path="transactions" element={
            <ProtectedRoute permission="canAccessTransactions">
              <Transactions />
            </ProtectedRoute>
          } />
          <Route path="staff" element={
            <ProtectedRoute permission="canAccessStaff">
              <Staff />
            </ProtectedRoute>
          } />
          <Route path="settings" element={
            <ProtectedRoute permission="canAccessSettings">
              <Settings />
            </ProtectedRoute>
          } />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;