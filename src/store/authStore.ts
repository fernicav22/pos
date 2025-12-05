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

// Helper function to fetch and set user data
const fetchAndSetUser = async (userId: string): Promise<void> => {
  try {
    console.log('AuthStore: Fetching user data for ID:', userId);
    
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

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

    console.log('AuthStore: User data fetched successfully:', userData);

    const userState = {
      id: userData.id,
      email: userData.email,
      role: userData.role,
      firstName: userData.first_name,
      lastName: userData.last_name,
      created_at: userData.created_at
    };

    console.log('AuthStore: Setting user state:', userState);
    useAuthStore.getState().setUser(userState);
  } catch (error) {
    console.error('AuthStore: Exception in fetchAndSetUser:', error);
    useAuthStore.getState().setUser(null);
  }
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  
  initializeAuth: async () => {
    try {
      console.log('AuthStore: Initializing auth...');
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('AuthStore: Error getting session:', error);
        set({ user: null, loading: false });
        return;
      }

      if (session?.user) {
        console.log('AuthStore: Found existing session');
        await fetchAndSetUser(session.user.id);
      } else {
        console.log('AuthStore: No existing session');
        set({ user: null, loading: false });
      }
    } catch (error) {
      console.error('AuthStore: Error initializing auth:', error);
      set({ user: null, loading: false });
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
    await supabase.auth.signOut();
    set({ user: null, loading: false });
  },
  
  setUser: (user) => set({ user, loading: false }),
}));

// Initialize auth state on app load
useAuthStore.getState().initializeAuth();

// Listen for auth state changes
supabase.auth.onAuthStateChange(async (event, session) => {
  console.log('AuthStore: Auth state change event:', event, 'Session:', !!session);
  
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    if (session?.user) {
      await fetchAndSetUser(session.user.id);
    }
  } else if (event === 'SIGNED_OUT') {
    console.log('AuthStore: Signed out, clearing user');
    useAuthStore.getState().setUser(null);
  }
});