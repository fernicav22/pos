import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { Save, X, Coins } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface SettingsFormData {
  store: {
    name: string;
    address: string;
    phone: string;
    email: string;
    website: string;
  };
  tax: {
    rate: number;
    inclusive: boolean;
  };
  currency: {
    code: string;
    symbol: string;
    position: 'before' | 'after';
  };
  inventory: {
    lowStockThreshold: number;
    outOfStockThreshold: number;
    enableStockTracking: boolean;
  };
  receipt: {
    header: string;
    footer: string;
    showTaxDetails: boolean;
    showItemizedList: boolean;
  };
}

export default function Settings() {
  const { user } = useAuthStore();
  const { settings, updateSettings, loadSettings, formatCurrency } = useSettingsStore();
  const [formData, setFormData] = useState<SettingsFormData>(settings);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Cash drawer management state (admin only)
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [newCashAmount, setNewCashAmount] = useState('');
  const [cashAdjustmentReason, setCashAdjustmentReason] = useState('');
  const [adjustingCash, setAdjustingCash] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Helper to safely handle numeric values - prevents NaN from appearing in inputs
  const getSafeNumericValue = (value: any, defaultValue: number = 0): number => {
    const num = Number(value);
    return isNaN(num) || num === null || num === undefined ? defaultValue : num;
  };

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    // Ensure numeric values are safe when settings load
    const safeSettings = {
      ...settings,
      tax: {
        ...settings.tax,
        rate: getSafeNumericValue(settings.tax.rate, 10)
      },
      inventory: {
        ...settings.inventory,
        lowStockThreshold: getSafeNumericValue(settings.inventory.lowStockThreshold, 10),
        outOfStockThreshold: getSafeNumericValue(settings.inventory.outOfStockThreshold, 0)
      }
    } as SettingsFormData;
    
    setFormData(safeSettings);
  }, [settings]);

  // Load users for cash adjustment (admin only)
  useEffect(() => {
    if (user?.role === 'admin') {
      fetchUsers();
    }
  }, [user?.role]);

  const fetchUsers = async () => {
    try {
      setLoadingUsers(true);
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email, role, cash_on_hand')
        .order('first_name');

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCashAdjustment = async () => {
    if (!selectedUserId || !newCashAmount) {
      toast.error('Please select a user and enter a new cash amount');
      return;
    }

    try {
      setAdjustingCash(true);

      // Get the selected user's current cash balance
      const selectedUser = users.find(u => u.id === selectedUserId);
      if (!selectedUser) {
        toast.error('User not found');
        return;
      }

      const oldAmount = selectedUser.cash_on_hand || 0;
      const newAmount = parseFloat(newCashAmount);

      if (isNaN(newAmount)) {
        toast.error('Invalid amount');
        return;
      }

      // Update the user's cash_on_hand
      const { error: updateError } = await supabase
        .from('users')
        .update({ cash_on_hand: newAmount })
        .eq('id', selectedUserId);

      if (updateError) throw updateError;

      // Log the adjustment to cash_adjustments table
      const { error: logError } = await supabase
        .from('cash_adjustments')
        .insert({
          user_id: selectedUserId,
          admin_id: user?.id,
          old_amount: oldAmount,
          new_amount: newAmount,
          reason: cashAdjustmentReason || null
        });

      if (logError) throw logError;

      toast.success(`Cash balance adjusted from ${formatCurrency(oldAmount)} to ${formatCurrency(newAmount)}`);
      
      // Reset form and refresh users list
      setSelectedUserId('');
      setNewCashAmount('');
      setCashAdjustmentReason('');
      fetchUsers();
    } catch (error: any) {
      console.error('Error adjusting cash:', error);
      toast.error(error.message || 'Failed to adjust cash balance');
    } finally {
      setAdjustingCash(false);
    }
  };

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <p className="text-red-600">
          You need admin or manager permissions to access settings
        </p>
      </div>
    );
  }

  const handleInputChange = (
    section: keyof SettingsFormData,
    field: string,
    value: string | number | boolean
  ) => {
    // If it's a numeric field, ensure it's not NaN
    let safeValue = value;
    if (typeof value === 'number') {
      safeValue = getSafeNumericValue(value, 0);
    }
    
    setFormData((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: safeValue,
      },
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateSettings(formData);
      setEditMode(false);
      toast.success('Settings updated successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData(settings as SettingsFormData);
    setEditMode(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <div className="flex space-x-3">
          {editMode ? (
            <>
              <button
                onClick={handleCancel}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                disabled={saving}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                disabled={saving}
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Edit Settings
            </button>
          )}
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <div className="space-y-6">
          {/* Store Information */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Store Information</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Store Name</label>
                {editMode ? (
                  <input
                    type="text"
                    value={formData.store.name}
                    onChange={(e) => handleInputChange('store', 'name', e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{settings.store.name}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Address</label>
                {editMode ? (
                  <input
                    type="text"
                    value={formData.store.address}
                    onChange={(e) => handleInputChange('store', 'address', e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{settings.store.address}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Phone</label>
                {editMode ? (
                  <input
                    type="tel"
                    value={formData.store.phone}
                    onChange={(e) => handleInputChange('store', 'phone', e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{settings.store.phone}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                {editMode ? (
                  <input
                    type="email"
                    value={formData.store.email}
                    onChange={(e) => handleInputChange('store', 'email', e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{settings.store.email}</p>
                )}
              </div>
            </div>
          </div>

          {/* Tax Settings */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Tax Settings</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Tax Rate (%)</label>
                {editMode ? (
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={isNaN(formData.tax.rate) ? 0 : formData.tax.rate}
                    onChange={(e) => handleInputChange('tax', 'rate', parseFloat(e.target.value))}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{settings.tax.rate}%</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Tax Inclusive</label>
                {editMode ? (
                  <select
                    value={formData.tax.inclusive.toString()}
                    onChange={(e) => handleInputChange('tax', 'inclusive', e.target.value === 'true')}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <p className="mt-1 text-sm text-gray-900">
                    {settings.tax.inclusive ? 'Yes' : 'No'}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Currency Settings */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Currency Settings</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Currency Code</label>
                {editMode ? (
                  <input
                    type="text"
                    value={formData.currency.code}
                    onChange={(e) => handleInputChange('currency', 'code', e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{settings.currency.code}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Currency Symbol</label>
                {editMode ? (
                  <input
                    type="text"
                    value={formData.currency.symbol}
                    onChange={(e) => handleInputChange('currency', 'symbol', e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{settings.currency.symbol}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Symbol Position</label>
                {editMode ? (
                  <select
                    value={formData.currency.position}
                    onChange={(e) => handleInputChange('currency', 'position', e.target.value as 'before' | 'after')}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="before">Before</option>
                    <option value="after">After</option>
                  </select>
                ) : (
                  <p className="mt-1 text-sm text-gray-900 capitalize">
                    {settings.currency.position}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Inventory Settings */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Inventory Settings</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Low Stock Threshold</label>
                {editMode ? (
                  <input
                    type="number"
                    min="0"
                    value={isNaN(formData.inventory.lowStockThreshold) ? 0 : formData.inventory.lowStockThreshold}
                    onChange={(e) => handleInputChange('inventory', 'lowStockThreshold', parseInt(e.target.value))}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">
                    {settings.inventory.lowStockThreshold} units
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Out of Stock Threshold</label>
                {editMode ? (
                  <input
                    type="number"
                    min="0"
                    value={isNaN(formData.inventory.outOfStockThreshold) ? 0 : formData.inventory.outOfStockThreshold}
                    onChange={(e) => handleInputChange('inventory', 'outOfStockThreshold', parseInt(e.target.value))}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">
                    {settings.inventory.outOfStockThreshold} units
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Stock Tracking</label>
                {editMode ? (
                  <select
                    value={formData.inventory.enableStockTracking.toString()}
                    onChange={(e) => handleInputChange('inventory', 'enableStockTracking', e.target.value === 'true')}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                ) : (
                  <p className="mt-1 text-sm text-gray-900">
                    {settings.inventory.enableStockTracking ? 'Enabled' : 'Disabled'}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Receipt Settings */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Receipt Settings</h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Header Message</label>
                {editMode ? (
                  <textarea
                    value={formData.receipt.header}
                    onChange={(e) => handleInputChange('receipt', 'header', e.target.value)}
                    rows={2}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{settings.receipt.header}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Footer Message</label>
                {editMode ? (
                  <textarea
                    value={formData.receipt.footer}
                    onChange={(e) => handleInputChange('receipt', 'footer', e.target.value)}
                    rows={2}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{settings.receipt.footer}</p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Show Tax Details</label>
                  {editMode ? (
                    <select
                      value={formData.receipt.showTaxDetails.toString()}
                      onChange={(e) => handleInputChange('receipt', 'showTaxDetails', e.target.value === 'true')}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">
                      {settings.receipt.showTaxDetails ? 'Yes' : 'No'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Show Itemized List</label>
                  {editMode ? (
                    <select
                      value={formData.receipt.showItemizedList.toString()}
                      onChange={(e) => handleInputChange('receipt', 'showItemizedList', e.target.value === 'true')}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">
                      {settings.receipt.showItemizedList ? 'Yes' : 'No'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cash Drawer Management (Admin Only) */}
      {user?.role === 'admin' && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center mb-6">
            <Coins className="h-6 w-6 text-green-600 mr-2" />
            <h2 className="text-xl font-semibold text-gray-900">Cash Drawer Management</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Cashier</label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={adjustingCash}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="">Choose a user...</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name} ({u.role}) - Current: {formatCurrency(u.cash_on_hand || 0)}
                  </option>
                ))}
              </select>
            </div>

            {selectedUserId && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Current Cash Balance</label>
                  <div className="block w-full px-4 py-2 rounded-md border border-gray-300 bg-gray-50 text-gray-900 font-semibold">
                    {formatCurrency(users.find(u => u.id === selectedUserId)?.cash_on_hand || 0)}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">New Cash Amount</label>
                  <div className="relative">
                    <span className="absolute left-4 top-3 text-gray-500">{settings.currency.symbol}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newCashAmount}
                      onChange={(e) => setNewCashAmount(e.target.value)}
                      placeholder="0.00"
                      disabled={adjustingCash}
                      className="block w-full pl-8 pr-4 py-2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Reason (Optional)</label>
                  <input
                    type="text"
                    value={cashAdjustmentReason}
                    onChange={(e) => setCashAdjustmentReason(e.target.value)}
                    placeholder="e.g., Cash drop, Opening balance, Correction"
                    disabled={adjustingCash}
                    className="block w-full px-4 py-2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>

                <button
                  onClick={handleCashAdjustment}
                  disabled={adjustingCash || !newCashAmount}
                  className="w-full bg-green-600 text-white py-2 rounded-md font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {adjustingCash ? 'Saving...' : 'Update Cash Balance'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}