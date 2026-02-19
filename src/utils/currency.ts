/**
 * Simple currency utilities to fix floating point issues
 * All amounts are handled as integers (cents) internally
 */

/**
 * Convert dollar amount to cents (integer)
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convert cents to dollars with proper rounding
 */
export function toDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Round a dollar amount to 2 decimal places
 */
export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Calculate tax amount with proper rounding
 */
export function calculateTaxAmount(subtotal: number, taxRate: number): number {
  const subtotalCents = toCents(subtotal);
  const taxCents = Math.round((subtotalCents * taxRate) / 100);
  return toDollars(taxCents);
}

/**
 * Calculate total with proper rounding
 */
export function calculateTotal(subtotal: number, tax: number, shipping: number = 0): number {
  const totalCents = toCents(subtotal) + toCents(tax) + toCents(shipping);
  return toDollars(totalCents);
}

/**
 * Format amount as currency string
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}
