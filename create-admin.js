// Create Admin User via Supabase Admin API
// Run: node create-admin.js

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vvjcpxqgbnvobpeypvts.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // You need to set this

if (!supabaseServiceKey) {
  console.error('Please set SUPABASE_SERVICE_ROLE_KEY environment variable');
  console.log('Get it from: https://supabase.com/dashboard/project/vvjcpxqgbnvobpeypvts/settings/api');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function createAdminUser() {
  try {
    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: 'admin@pos.com',
      password: 'admin123',
      email_confirm: true,
      user_metadata: {
        first_name: 'Admin',
        last_name: 'User'
      }
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      return;
    }

    console.log('✅ Auth user created:', authData.user.email);

    // Update role to admin in public.users (trigger should have created the record)
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        role: 'admin',
        first_name: 'Admin',
        last_name: 'User'
      })
      .eq('id', authData.user.id);

    if (updateError) {
      console.error('Error updating user role:', updateError);
      return;
    }

    console.log('✅ Admin user created successfully!');
    console.log('📧 Email: admin@pos.com');
    console.log('🔑 Password: admin123');
    console.log('⚠️  Please change the password after first login!');
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

createAdminUser();
