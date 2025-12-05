import { create } from 'zustand';
import { User } from '../types';
import { supabase } from '../lib/supabase';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
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
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', authData.user.id)
          .single();

        if (userError) {
          console.error('AuthStore: Error fetching user data:', userError);
          throw userError;
        }

        console.log('AuthStore: User data fetched:', userData);

        const userState = {
          id: userData.id,
          email: userData.email,
          role: userData.role,
          firstName: userData.first_name,
          lastName: userData.last_name,
          created_at: userData.created_at
        };

        console.log('AuthStore: Setting user state:', userState);

        set({ 
          user: userState,
          loading: false
        });

        console.log('AuthStore: User state set successfully');
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

// Initialize auth state
supabase.auth.onAuthStateChange(async (event, session) => {
  console.log('AuthStore: Auth state change event:', event, 'Session:', !!session);
  
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
    if (session?.user) {
      try {
        console.log('AuthStore: Fetching user data for session...');
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (userError) {
          console.error('AuthStore: Error in auth state change:', userError);
          throw userError;
        }

        console.log('AuthStore: User data from session:', userData);

        const userState = {
          id: userData.id,
          email: userData.email,
          role: userData.role,
          firstName: userData.first_name,
          lastName: userData.last_name,
          created_at: userData.created_at
        };

        console.log('AuthStore: Setting user from session:', userState);
        useAuthStore.getState().setUser(userState);
      } catch (error) {
        console.error('Error fetching user data:', error);
        useAuthStore.getState().setUser(null);
      }
    } else {
      console.log('AuthStore: No session user, setting null');
      useAuthStore.getState().setUser(null);
    }
  } else if (event === 'SIGNED_OUT') {
    console.log('AuthStore: Signed out, setting null');
    useAuthStore.getState().setUser(null);
  }
});