export type UserRole = 'admin' | 'manager' | 'cashier';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  price: number;
  cost: number;
  categoryId: string;
  description?: string;
  stockQuantity: number;
  lowStockAlert: number;
  attributes: Record<string, string>;
  variants: ProductVariant[];
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku: string;
  price: number;
  stockQuantity: number;
  attributes: Record<string, string>;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
}

export interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  loyaltyPoints: number;
  totalPurchases: number;
  segment: string;
  created_at: string;
}

export interface Sale {
  id: string;
  customerId?: string;
  userId: string;
  total: number;
  tax: number;
  discount: number;
  paymentMethod: string;
  status: 'completed' | 'refunded' | 'partially_refunded';
  items: SaleItem[];
  created_at: string;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  variantId?: string;
  quantity: number;
  price: number;
  discount: number;
}