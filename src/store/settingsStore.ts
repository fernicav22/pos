import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import defaultSettings from '../config/settings.json';

interface SettingsState {
  settings: typeof defaultSettings;
  formatCurrency: (amount: number) => string;
  calculateTax: (amount: number) => number;
  updateSettings: (newSettings: typeof defaultSettings) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,

      formatCurrency: (amount: number) => {
        const { code, symbol, position } = get().settings.currency;
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

      updateSettings: async (newSettings) => {
        try {
          // Here you could add API calls to save settings to a backend
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