import { Customer } from '../types';

export const mockCustomers: Customer[] = [
  {
    id: '1',
    email: 'john.doe@example.com',
    firstName: 'John',
    lastName: 'Doe',
    phone: '(555) 123-4567',
    loyaltyPoints: 150,
    totalPurchases: 1500,
    segment: 'Gold',
    created_at: '2024-01-15T10:00:00Z'
  },
  {
    id: '2',
    email: 'jane.smith@example.com',
    firstName: 'Jane',
    lastName: 'Smith',
    phone: '(555) 234-5678',
    loyaltyPoints: 75,
    totalPurchases: 750,
    segment: 'Silver',
    created_at: '2024-01-20T14:30:00Z'
  },
  {
    id: '3',
    email: 'bob.wilson@example.com',
    firstName: 'Bob',
    lastName: 'Wilson',
    phone: '(555) 345-6789',
    loyaltyPoints: 25,
    totalPurchases: 250,
    segment: 'Bronze',
    created_at: '2024-02-01T09:15:00Z'
  }
];