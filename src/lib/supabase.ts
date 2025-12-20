import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables:', {
    hasUrl: !!supabaseUrl,
    hasAnonKey: !!supabaseAnonKey
  });
  throw new Error('Missing required environment variables for Supabase configuration');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Connection test with timeout (non-blocking, optional)
const testConnection = async () => {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection test timeout')), 3000);
    });
    
    const testPromise = supabase.from('users').select('count');
    
    await Promise.race([testPromise, timeoutPromise]);
    console.log('Supabase connection test successful');
  } catch (error) {
    console.debug('Supabase connection test failed (non-blocking):', error);
  }
};

// Run test in background without blocking initialization
if (typeof window !== 'undefined') {
  // Use setTimeout to avoid blocking module load
  setTimeout(() => testConnection(), 100);
}