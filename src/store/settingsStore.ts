import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import defaultSettings from '../config/settings.json';
import { supabase } from '../lib/supabase';

// Define defaults for numeric fields to prevent NaN
const NUMERIC_DEFAULTS = {
  tax_rate: 10,
  low_stock_threshold: 10,
  outOfStockThreshold: 0,
} as const;

// Sanitize settings to remove NaN and null values from numeric fields
const sanitizeSettings = (rawSettings: any) => {
  if (!rawSettings) return null;

  // Helper function to safely convert to number
  const toNumber = (value: any, defaultVal: number): number => {
    const num = Number(value);
    return isNaN(num) || num === null || num === undefined ? defaultVal : num;
  };

  return {
    store: {
      name: rawSettings.store_name || defaultSettings.store.name,
      address: rawSettings.store_address || defaultSettings.store.address,
      phone: rawSettings.store_phone || '',
      email: rawSettings.store_email || '',
      website: rawSettings.store_website || ''
    },
    tax: {
      rate: toNumber(rawSettings.tax_rate, defaultSettings.tax.rate),
      inclusive: rawSettings.tax_inclusive === true || rawSettings.tax_inclusive === 'true'
    },
    currency: {
      code: rawSettings.currency || defaultSettings.currency.code,
      symbol: rawSettings.currency === 'USD' ? '$' : rawSettings.currency || defaultSettings.currency.symbol,
      position: 'before' as const
    },
    inventory: {
      lowStockThreshold: toNumber(rawSettings.low_stock_threshold, defaultSettings.inventory.lowStockThreshold),
      outOfStockThreshold: toNumber(rawSettings.out_of_stock_threshold, defaultSettings.inventory.outOfStockThreshold),
      enableStockTracking: rawSettings.enable_stock_tracking !== false && rawSettings.enable_stock_tracking !== 'false'
    },
    receipt: {
      header: rawSettings.receipt_header || defaultSettings.receipt.header,
      footer: rawSettings.receipt_footer || defaultSettings.receipt.footer,
      showTaxDetails: rawSettings.show_tax_details !== false && rawSettings.show_tax_details !== 'false',
      showItemizedList: rawSettings.show_itemized_list !== false && rawSettings.show_itemized_list !== 'false'
    }
  };
};

interface SettingsState {
  settings: typeof defaultSettings;
  isLoading: boolean;
  isInitialized: boolean;
  formatCurrency: (amount: number) => string;
  calculateTax: (amount: number) => number;
  updateSettings: (newSettings: typeof defaultSettings) => Promise<void>;
  loadSettings: () => Promise<void>;
}

// Prevent duplicate settings loads
let settingsLoadPromise: Promise<void> | null = null;

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
        // Deduplicate concurrent load requests
        if (settingsLoadPromise) {
          console.log('SettingsStore: Deduplicating settings load request');
          return settingsLoadPromise;
        }

        // If already initialized, don't reload
        if (get().isInitialized) {
          console.log('SettingsStore: Already initialized, skipping load');
          return;
        }

        settingsLoadPromise = (async () => {
          try {
            set({ isLoading: true });
            console.log('SettingsStore: Loading settings from database');
            
            // Add timeout to prevent hanging
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Settings fetch timeout')), 3000);
            });
            
            const fetchPromise = supabase
              .from('store_settings')
              .select('*')
              .limit(1);
            
            const { data, error } = await Promise.race([
              fetchPromise,
              timeoutPromise.catch(() => ({ data: null, error: new Error('Settings timeout') }))
            ]) as any;

            if (error) throw error;
            
            // Get the first record if it exists
            const settingsRecord = data && data.length > 0 ? data[0] : null;

            if (settingsRecord) {
              console.log('SettingsStore: Raw settings from DB:', settingsRecord);
              
              // Sanitize the settings to remove NaN and null values
              const loadedSettings = sanitizeSettings(settingsRecord);
              
              if (!loadedSettings) {
                set({ isLoading: false, isInitialized: true });
                console.log('SettingsStore: Settings sanitization failed, using defaults');
                return;
              }
              
              set({ settings: loadedSettings, isLoading: false, isInitialized: true });
              console.log('SettingsStore: Settings loaded successfully:', loadedSettings);
            } else {
              set({ isLoading: false, isInitialized: true });
              console.log('SettingsStore: No settings found, using defaults');
            }
          } catch (error) {
            console.error('SettingsStore: Error loading settings:', error);
            set({ isLoading: false, isInitialized: true });
          } finally {
            settingsLoadPromise = null;
          }
        })();

        return settingsLoadPromise;
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
