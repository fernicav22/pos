// Temporary diagnostic script to check database settings
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  console.log('VITE_SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
  console.log('VITE_SUPABASE_ANON_KEY:', supabaseKey ? 'Set' : 'Missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSettings() {
  console.log('\n=== Checking Store Settings ===\n');
  
  const { data, error } = await supabase
    .from('store_settings')
    .select('*')
    .limit(1)
    .single();

  if (error) {
    console.error('Error fetching settings:', error);
    return;
  }

  if (!data) {
    console.log('No settings found in database!');
    return;
  }

  console.log('Database Settings:');
  console.log('-------------------');
  console.log('Store Name:', data.store_name);
  console.log('Tax Rate:', data.tax_rate, '(type:', typeof data.tax_rate + ')');
  console.log('Tax Inclusive:', data.tax_inclusive);
  console.log('Currency:', data.currency);
  console.log('\nFull record:');
  console.log(JSON.stringify(data, null, 2));
}

checkSettings();
