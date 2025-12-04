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
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) throw authError;

      if (authData.user) {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', authData.user.id)
          .single();

        if (userError) throw userError;

        set({ 
          user: {
            id: userData.id,
            email: userData.email,
            role: userData.role,
            firstName: userData.first_name,
            lastName: userData.last_name,
            created_at: userData.created_at
          },
          loading: false
        });
      }
    } catch (error) {
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
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
    if (session?.user) {
      try {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (userError) throw userError;

        useAuthStore.getState().setUser({
          id: userData.id,
          email: userData.email,
          role: userData.role,
          firstName: userData.first_name,
          lastName: userData.last_name,
          created_at: userData.created_at
        });
      } catch (error) {
        console.error('Error fetching user data:', error);
        useAuthStore.getState().setUser(null);
      }
    } else {
      useAuthStore.getState().setUser(null);
    }
  } else if (event === 'SIGNED_OUT') {
    useAuthStore.getState().setUser(null);
  }
});