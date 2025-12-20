import { create } from 'zustand';
import { User } from '../types';
import { supabase } from '../lib/supabase';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: User | null) => void;
  initializeAuth: () => Promise<void>;
}

// Flags to prevent race conditions
let isInitializing = false;
let isInitialized = false;
let fetchUserPromise: Promise<void> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;

// Helper function to fetch and set user data with deduplication and retry logic
const fetchAndSetUser = async (userId: string, maxRetries = 2): Promise<void> => {
  // Deduplicate concurrent requests for the same user
  if (fetchUserPromise) {
    console.log('AuthStore: Deduplicating user fetch request');
    return fetchUserPromise;
  }

  fetchUserPromise = (async () => {
    let lastError: any = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let timeoutHandle: NodeJS.Timeout | null = null;
      
      try {
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`AuthStore: Retry attempt ${attempt}/${maxRetries}, waiting ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        console.log('AuthStore: Fetching user data for ID:', userId);
        
        // Create a promise that rejects after timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error('User fetch timeout'));
          }, 5000); // Reduced from 10s to 5s per attempt
        });
        
        // Create the fetch promise - only select needed columns
        const fetchPromise = supabase
          .from('users')
          .select('id, email, role, first_name, last_name, created_at')
          .eq('id', userId)
          .single();
        
        // Race between fetch and timeout
        const { data: userData, error: userError } = await Promise.race([
          fetchPromise,
          timeoutPromise.catch(timeoutError => ({ 
            data: null, 
            error: timeoutError 
          }))
        ]);
        
        // Clear timeout on success
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        if (userError) {
          lastError = userError;
          if (userError.message === 'User fetch timeout') {
            console.warn(`AuthStore: User fetch timeout after 5000ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            if (attempt < maxRetries) continue; // Retry
          } else {
            console.warn(`AuthStore: User fetch error: ${userError.message} (attempt ${attempt + 1}/${maxRetries + 1})`);
            if (attempt < maxRetries) continue; // Retry on other errors too
          }
          throw userError;
        }

        if (!userData) {
          console.error('AuthStore: No user data returned');
          useAuthStore.getState().setUser(null);
          return;
        }

        console.log('AuthStore: User data fetched successfully');

        const userState: User = {
          id: userData.id,
          email: userData.email,
          role: userData.role,
          firstName: userData.first_name,
          lastName: userData.last_name,
          created_at: userData.created_at
        };

        console.log('AuthStore: Setting user state');
        useAuthStore.getState().setUser(userState);
        return; // Success - exit retry loop
      } catch (error: any) {
        lastError = error;
        if (attempt < maxRetries) {
          continue; // Try again
        }
        // All retries exhausted
        console.error('AuthStore: Failed to fetch user after', maxRetries + 1, 'attempts:', error.message);
        useAuthStore.getState().setUser(null);
      } finally {
        // Always cleanup timeout
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      }
    }
    
    // Clear the promise to allow future fetches
    fetchUserPromise = null;
  })();

  return fetchUserPromise;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  
  initializeAuth: async () => {
    // Prevent duplicate initialization
    if (isInitializing || isInitialized) {
      console.log('AuthStore: Already initializing or initialized, skipping');
      return;
    }

    isInitializing = true;

    try {
      console.log('AuthStore: Initializing auth...');
      
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('AuthStore: Error getting session:', error);
        set({ user: null, loading: false });
        isInitialized = true;
        return;
      }

      if (session?.user) {
        console.log('AuthStore: Found existing session');
        await fetchAndSetUser(session.user.id);
      } else {
        console.log('AuthStore: No existing session');
        set({ user: null, loading: false });
      }
      
      isInitialized = true;
    } catch (error) {
      console.error('AuthStore: Error initializing auth:', error);
      set({ user: null, loading: false });
      isInitialized = true;
    } finally {
      isInitializing = false;
    }
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true });
    try {
      console.log('AuthStore: Starting sign in...');
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) throw authError;
      
      // Don't fetch user data here - let onAuthStateChange handle it
      // This prevents duplicate fetching
      console.log('AuthStore: Sign in successful, waiting for auth state change...');
    } catch (error) {
      console.error('AuthStore: Sign in error:', error);
      set({ loading: false });
      throw error;
    }
  },
  
  signOut: async () => {
    set({ loading: true });
    try {
      await supabase.auth.signOut();
      set({ user: null, loading: false });
      
      // Reset initialization flags to allow re-initialization
      isInitialized = false;
      isInitializing = false;
      fetchUserPromise = null;
    } catch (error) {
      console.error('AuthStore: Sign out error:', error);
      set({ user: null, loading: false });
    }
  },
  
  setUser: (user) => {
    console.log('AuthStore: setUser called with:', user ? 'user data' : 'null');
    set({ user, loading: false });
  },
}));

// Cleanup function for auth subscription
const cleanupAuthSubscription = () => {
  if (authSubscription) {
    console.log('AuthStore: Cleaning up auth subscription');
    authSubscription.unsubscribe();
    authSubscription = null;
  }
};

// Initialize auth state on app load
console.log('AuthStore: Module loaded, initializing...');
useAuthStore.getState().initializeAuth();

// Listen for auth state changes with proper cleanup
const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
  console.log('AuthStore: Auth state change event:', event, 'Session:', !!session);
  
  // Handle different auth events
  switch (event) {
    case 'INITIAL_SESSION':
      // Handle initial session check
      console.log('AuthStore: Initial session check');
      if (session?.user) {
        // Session exists, user is already logged in
        if (!useAuthStore.getState().user && !isInitializing) {
          await fetchAndSetUser(session.user.id);
        }
      } else {
        // No session, ensure loading is false
        useAuthStore.getState().setUser(null);
      }
      break;
      
    case 'SIGNED_IN':
      // Fetch user data on sign in
      if (session?.user) {
        console.log('AuthStore: SIGNED_IN event, fetching user data');
        await fetchAndSetUser(session.user.id);
      }
      break;
      
    case 'TOKEN_REFRESHED':
      // Token refresh doesn't require refetching user data
      // Just ensure loading is false
      console.log('AuthStore: TOKEN_REFRESHED event, session still valid');
      if (useAuthStore.getState().loading) {
        useAuthStore.getState().setUser(useAuthStore.getState().user);
      }
      break;
      
    case 'SIGNED_OUT':
      console.log('AuthStore: SIGNED_OUT event, clearing user');
      useAuthStore.getState().setUser(null);
      isInitialized = false;
      isInitializing = false;
      fetchUserPromise = null;
      break;
      
    case 'USER_UPDATED':
      // User data changed, refetch
      if (session?.user) {
        console.log('AuthStore: USER_UPDATED event, refetching user data');
        await fetchAndSetUser(session.user.id);
      }
      break;
      
    default:
      console.log('AuthStore: Unhandled auth event:', event);
  }
});

// Store the subscription for cleanup
authSubscription = subscription;

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', cleanupAuthSubscription);
  
  // Also cleanup on hot reload in development
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      console.log('AuthStore: Hot reload cleanup');
      cleanupAuthSubscription();
    });
  }
}

// Export cleanup function for manual cleanup if needed
export const cleanupAuth = cleanupAuthSubscription;
