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

// Helper function to fetch and set user data with deduplication
const fetchAndSetUser = async (userId: string, timeout = 10000): Promise<void> => {
  // Deduplicate concurrent requests for the same user
  if (fetchUserPromise) {
    console.log('AuthStore: Deduplicating user fetch request');
    return fetchUserPromise;
  }

  fetchUserPromise = (async () => {
    try {
      console.log('AuthStore: Fetching user data for ID:', userId);
      
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('User fetch timeout')), timeout);
      });

      // Race between fetch and timeout
      const { data: userData, error: userError } = await Promise.race([
        supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .single(),
        timeoutPromise
      ]) as any;

      if (userError) {
        console.error('AuthStore: Error fetching user data:', userError);
        useAuthStore.getState().setUser(null);
        return;
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
    } catch (error) {
      console.error('AuthStore: Exception in fetchAndSetUser:', error);
      useAuthStore.getState().setUser(null);
    } finally {
      // Always clear the promise to allow future fetches
      fetchUserPromise = null;
    }
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
      console.log('AuthStore: Auth successful, fetching user data...');

      if (authData.user) {
        await fetchAndSetUser(authData.user.id);
      }
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
    case 'SIGNED_IN':
      // Only fetch user data if not already initializing
      if (session?.user && !isInitializing) {
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
