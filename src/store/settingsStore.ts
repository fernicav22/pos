import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import defaultSettings from '../config/settings.json';
import { supabase } from '../lib/supabase';

interface SettingsState {
  settings: typeof defaultSettings;
  isLoading: boolean;
  isInitialized: boolean;
  formatCurrency: (amount: number) => string;
  calculateTax: (amount: number) => number;
  updateSettings: (newSettings: typeof defaultSettings) => Promise<void>;
  loadSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      isLoading: false,
      isInitialized: false,

      formatCurrency: (amount: number) => {
        const { symbol, position } = get().settings.currency;
        const formatted = new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(amount);

        return position === 'before' ? `${symbol}${formatted}` : `${formatted}${symbol}`;
      },

      calculateTax: (amount: number) => {
        const { rate, inclusive } = get().settings.tax;
        if (inclusive) {
          return (amount * rate) / (100 + rate);
        }
        return (amount * rate) / 100;
      },

      loadSettings: async () => {
        try {
          set({ isLoading: true });
          console.log('Loading settings from database...');
          
          // Try to get settings - use limit(1) and get first item instead of single()
          const { data, error } = await supabase
            .from('store_settings')
            .select('*')
            .limit(1);

          if (error) {
            console.error('Error fetching settings:', error);
            throw error;
          }

          console.log('Raw data from database:', data);
          
          // Get the first record if it exists
          const settingsRecord = data && data.length > 0 ? data[0] : null;

          if (settingsRecord) {
            // Map database fields to settings structure
            const loadedSettings = {
              store: {
                name: settingsRecord.store_name,
                address: settingsRecord.store_address,
                phone: settingsRecord.store_phone || '',
                email: settingsRecord.store_email || '',
                website: settingsRecord.store_website || ''
              },
              tax: {
                rate: Number(settingsRecord.tax_rate),
                inclusive: settingsRecord.tax_inclusive || false
              },
              currency: {
                code: settingsRecord.currency,
                symbol: settingsRecord.currency === 'USD' ? '$' : settingsRecord.currency,
                position: 'before' as const
              },
              inventory: {
                lowStockThreshold: settingsRecord.low_stock_threshold || 5,
                outOfStockThreshold: 0,
                enableStockTracking: settingsRecord.enable_stock_tracking !== false
              },
              receipt: {
                header: settingsRecord.receipt_header || '',
                footer: settingsRecord.receipt_footer || '',
                showTaxDetails: settingsRecord.show_tax_details !== false,
                showItemizedList: settingsRecord.show_itemized_list !== false
              }
            };
            console.log('Loaded settings:', loadedSettings);
            console.log('Tax rate from DB:', settingsRecord.tax_rate, '-> Converted to:', loadedSettings.tax.rate);
            set({ settings: loadedSettings, isLoading: false, isInitialized: true });
          } else {
            console.log('No settings found in database, using defaults');
            set({ isLoading: false, isInitialized: true });
          }
        } catch (error) {
          console.error('Error loading settings:', error);
          // Keep default settings if loading fails
          set({ isLoading: false, isInitialized: true });
        }
      },

      updateSettings: async (newSettings) => {
        try {
          // Save to database
          const { error } = await supabase.rpc('upsert_store_settings', {
            p_store_name: newSettings.store.name,
            p_store_address: newSettings.store.address,
            p_store_phone: newSettings.store.phone || '',
            p_store_email: newSettings.store.email || '',
            p_store_website: newSettings.store.website || '',
            p_currency: newSettings.currency.code,
            p_tax_rate: newSettings.tax.rate,
            p_tax_inclusive: newSettings.tax.inclusive,
            p_receipt_header: newSettings.receipt.header,
            p_receipt_footer: newSettings.receipt.footer,
            p_low_stock_threshold: newSettings.inventory.lowStockThreshold,
            p_enable_stock_tracking: newSettings.inventory.enableStockTracking,
            p_show_tax_details: newSettings.receipt.showTaxDetails,
            p_show_itemized_list: newSettings.receipt.showItemizedList
          });

          if (error) throw error;

          // Update local state
          set({ settings: newSettings });
        } catch (error) {
          console.error('Error updating settings:', error);
          throw error;
        }
      }
    }),
    {
      name: 'pos-settings',
      partialize: (state) => ({ settings: state.settings })
    }
  )
);