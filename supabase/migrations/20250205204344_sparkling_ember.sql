-- Create the store_settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS store_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_name TEXT NOT NULL,
    store_address TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'USD',
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    receipt_footer TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_store_settings_updated_at ON store_settings;
CREATE TRIGGER update_store_settings_updated_at
    BEFORE UPDATE ON store_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated users to read store settings" ON store_settings;
DROP POLICY IF EXISTS "Allow admin/manager to insert store settings" ON store_settings;
DROP POLICY IF EXISTS "Allow admin/manager to update store settings" ON store_settings;
DROP POLICY IF EXISTS "Allow admin/manager to delete store settings" ON store_settings;

-- Create new policies using the users table directly
CREATE POLICY "Allow authenticated users to read store settings"
    ON store_settings
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow admin/manager to insert store settings"
    ON store_settings
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'manager')
        )
    );

CREATE POLICY "Allow admin/manager to update store settings"
    ON store_settings
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'manager')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'manager')
        )
    );

CREATE POLICY "Allow admin/manager to delete store settings"
    ON store_settings
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'manager')
        )
    );

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_store_settings_updated_at ON store_settings(updated_at);

-- Insert initial settings if none exist
INSERT INTO store_settings (
    store_name,
    store_address,
    currency,
    tax_rate,
    receipt_footer
)
SELECT
    'My Store',
    '',
    'USD',
    0.00,
    'Thank you for your business!'
WHERE NOT EXISTS (SELECT 1 FROM store_settings);