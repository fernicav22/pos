import { UserRole } from '../types';

// Define what each role can access
export const rolePermissions: Record<UserRole, {
  canAccessPOS: boolean;
  canAccessProducts: boolean;
  canAccessCustomers: boolean;
  canAccessPurchases: boolean;
  canAccessReports: boolean;
  canAccessTransactions: boolean;
  canAccessShipments: boolean;
  canAccessStaff: boolean;
  canAccessSettings: boolean;
  canCompleteSales: boolean;
  canViewQuantities: boolean;
}> = {
  admin: {
    canAccessPOS: true,
    canAccessProducts: true,
    canAccessCustomers: true,
    canAccessPurchases: true,
    canAccessReports: true,
    canAccessTransactions: true,
    canAccessShipments: true,
    canAccessStaff: true,
    canAccessSettings: true,
    canCompleteSales: true,
    canViewQuantities: true,
  },
  manager: {
    canAccessPOS: true,
    canAccessProducts: false,
    canAccessCustomers: true,
    canAccessPurchases: true,
    canAccessReports: true,
    canAccessTransactions: true,
    canAccessShipments: true,
    canAccessStaff: false,
    canAccessSettings: false,
    canCompleteSales: true,
    canViewQuantities: true,
  },
  cashier: {
    canAccessPOS: true,
    canAccessProducts: false,
    canAccessCustomers: true,
    canAccessPurchases: false,
    canAccessReports: false,
    canAccessTransactions: true,
    canAccessShipments: true,
    canAccessStaff: false,
    canAccessSettings: false,
    canCompleteSales: true,
    canViewQuantities: true,
  },
  customer: {
    canAccessPOS: true,
    canAccessProducts: false,
    canAccessCustomers: false,
    canAccessPurchases: false,
    canAccessReports: false,
    canAccessTransactions: false,
    canAccessShipments: false,
    canAccessStaff: false,
    canAccessSettings: false,
    canCompleteSales: false,
    canViewQuantities: false,
  },
};

export function hasPermission(role: UserRole, permission: keyof typeof rolePermissions.admin): boolean {
  return rolePermissions[role][permission];
}
