# POS System Database Migrations

This document describes all database migrations for the POS system.

## Migration Order

Migrations are applied in chronological order based on their timestamp prefix:

### Initial Setup (February 2025)
1. **20250205102854_restless_shape.sql** - Initial schema
   - Creates core tables: users, products, categories, customers, sales, sale_items
   - Sets up RLS policies
   - Adds stock management triggers

2. **20250205111711_still_meadow.sql** - Admin user
   - Inserts default admin user

3. **20250205204344_sparkling_ember.sql** - Store settings
   - Creates store_settings table
   - Sets up settings management

4. **20250206195101_turquoise_trail.sql** - Stock function
   - Adds update_product_stock() function

5. **20250206202703_maroon_marsh.sql** - Shipping field
   - Adds shipping column to sales table

### Extended Features (April 2025)
6. **20250411065250_aged_lodge.sql** - Purchase management
   - Creates suppliers, purchases, purchase_items tables
   - Adds purchase order management
   - Implements stock updates on purchase receive

### Product Enhancements (December 2025)
7. **20251203000000_fix_missing_fields.sql** - Advanced features
   - Adds product variants support
   - Adds customer loyalty system
   - Adds discount fields
   - Adds category hierarchy
   - Creates products_with_variants view

### Code Integration (December 4, 2025)
8. **20251204000001_add_missing_users_fields.sql** - User fields
    - Ensures first_name and last_name exist in users table

9. **20251204000002_store_settings_integration.sql** - Settings enhancement
    - Adds store contact fields (phone, email, website)
    - Adds inventory settings
    - Adds receipt customization options
    - Creates get_store_settings() function

10. **20251204000003_fix_customer_fields_snake_case.sql** - Customer indexes
    - Adds indexes for customer searches
    - Optimizes name and email lookups

11. **20251204000004_add_category_field_compatibility.sql** - Product views
    - Creates products_with_category view
    - Adds product search indexes
    - Optimizes low stock queries

12. **20251204000005_enhance_sales_tracking.sql** - Sales optimization
    - Adds sales query indexes
    - Creates get_sales_summary() function
    - Optimizes report generation

13. **20251204000006_supplier_active_field.sql** - Supplier indexes
    - Adds supplier and purchase indexes
    - Optimizes purchase queries

14. **20251204000007_add_reference_number_to_purchases.sql** - Purchase tracking
    - Ensures reference_number field exists
    - Adds purchase lookup indexes

15. **20251204000008_comprehensive_indexes.sql** - Performance
    - Adds all missing indexes
    - Enables pg_trgm for fuzzy search
    - Optimizes all common query patterns

16. **20251204000009_settings_store_functions.sql** - Settings management
    - Creates upsert_store_settings() function
    - Enables Settings page to save to database
    - Ensures default settings exist

### Data Integrity & Security (December 4, 2025)
17. **20251204000010_fix_foreign_key_cascades.sql** - Relationship integrity
    - Fixes all foreign key ON DELETE/ON UPDATE behaviors
    - Adds CASCADE for dependent data
    - Adds RESTRICT to prevent accidental deletions
    - Adds SET NULL for optional relationships

18. **20251204000011_add_missing_triggers.sql** - Auto-update triggers
    - Adds updated_at triggers to all tables
    - Ensures timestamps are properly maintained
    - Centralizes update_updated_at_column() function## Database Schema Overview

### Core Tables
- **users** - Staff members with role-based access
- **products** - Product catalog with inventory
- **product_variants** - Product variations
- **categories** - Product categories with hierarchy
- **customers** - Customer information with loyalty tracking
- **sales** - Sales transactions
- **sale_items** - Line items in sales

### Purchase Management
- **suppliers** - Supplier information
- **purchases** - Purchase orders
- **purchase_items** - Items in purchase orders

### Configuration
- **store_settings** - Store configuration and preferences

## Views

- **products_with_variants** - Products joined with their variants
- **products_with_category** - Products joined with category information

## Functions

### Settings Management
- **upsert_store_settings()** - Update or insert store settings
- **get_store_settings()** - Retrieve current store settings

### Sales Analytics
- **get_sales_summary(start_date, end_date)** - Calculate sales metrics for date range

### Stock Management  
- **update_product_stock()** - Update product stock levels

## Indexes

Comprehensive indexes have been added for optimal query performance:
- Text search indexes using pg_trgm for fuzzy matching
- Composite indexes for common join patterns
- Date range indexes for reports and analytics
- Status and active field indexes for filtering

## Security

- Row Level Security (RLS) enabled on all tables
- Role-based access control (admin, manager, cashier)
- Foreign key constraints with proper CASCADE/RESTRICT behavior
- Updated_at triggers on all tables for audit trail
- **receipts** - Receipt PDFs (private)
- **documents** - Business documents (private)

### Views
- **products_with_variants** - Products joined with their variants
- **products_with_category** - Products with category names

### Functions
- **update_product_stock()** - Manually update product stock
- **check_stock_before_sale()** - Prevent overselling (trigger)
- **update_stock_on_purchase_receive()** - Update stock on receiving (trigger)
- **update_purchase_totals()** - Calculate purchase totals (trigger)
- **update_customer_stats()** - Update loyalty points (trigger)
- **update_customer_segment()** - Auto-assign customer segments (trigger)
- **update_updated_at_column()** - Auto-update timestamps (trigger)
- **get_store_settings()** - Retrieve current settings
- **upsert_store_settings()** - Save settings
- **get_sales_summary()** - Calculate sales metrics
- **get_low_stock_products()** - Get products below threshold
- **get_customer_purchase_history()** - Get customer purchase stats
- **get_top_selling_products()** - Get best selling products
- **calculate_profit_margin()** - Calculate product profit
- **get_inventory_value()** - Get total inventory value
- **get_daily_sales_summary()** - Get daily sales stats
- **create_audit_log()** - Create audit log entries (trigger)
- **validate_email()** - Email validation
- **validate_phone()** - Phone validation
- **validate_sku()** - SKU validation
- **validate_price()** - Price validation

## Running Migrations

To apply all migrations to your Supabase project:

```bash
# Reset and apply all migrations (CAUTION: destroys data)
supabase db reset

# Or apply new migrations only
supabase db push
```

## Migration Dependencies

- **pg_trgm extension** - Required for fuzzy text search (auto-installed)
- **uuid-ossp extension** - Required for UUID generation (auto-installed)

## RLS Policies Summary

All tables have Row Level Security (RLS) enabled:

### Database Tables
- **Users**: Can view own data only
- **Products**: All can view, admin/manager can modify
- **Product Variants**: All can view, admin/manager can modify
- **Categories**: All can view, admin/manager can modify
- **Customers**: All authenticated users can view/modify
- **Sales**: All can view, users create their own
- **Sale Items**: All can view, linked to sales creator
- **Suppliers**: Admin/manager only
- **Purchases**: Admin/manager only
- **Purchase Items**: Admin/manager only
- **Store Settings**: All can view, admin/manager can modify
- **Audit Logs**: Admin only

### Storage Buckets
- **product-images**: Public read, authenticated write, admin/manager delete
- **receipts**: Private, users access only their own
- **documents**: Admin/manager only

## Performance Optimizations

Key indexes added for:
- Date range queries (reports)
- Product search (name, SKU, barcode)
- Customer search (name, email, phone)
- Transaction filtering (status, payment method, dates)
- Low stock alerts
- Purchase order tracking
- Fuzzy text search using trigrams
- Image URL lookups
- Audit log queries

## Foreign Key Cascades

Properly configured relationships:
- **CASCADE**: sale_items on sales delete, purchase_items on purchases delete, product_variants on products delete
- **RESTRICT**: Prevents deletion of users/products/suppliers with associated records
- **SET NULL**: Optional relationships like customer_id in sales, category_id in products

## Data Validation

All tables have validation constraints:
- Email format validation
- Phone number format validation
- SKU format validation (alphanumeric with dashes/underscores)
- Price range validation (0 to 1,000,000)
- Tax rate validation (0% to 100%)
- Stock quantity validation (non-negative)

## Audit Trail

Complete audit system tracking:
- All INSERT/UPDATE/DELETE operations
- User identification
- Old and new data (JSONB)
- Timestamp of changes
- Table and record identification
- Admin-only access to logs
