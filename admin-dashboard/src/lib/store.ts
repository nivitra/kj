import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Admin { id: string; name: string; email: string; role: string; studio: { id: string; name: string } }

interface AuthStore {
  token: string | null;
  admin: Admin | null;
  /** False until localStorage rehydration finishes — avoid redirect-to-login flash. */
  _hasHydrated: boolean;
  setAuth: (token: string, admin: Admin) => void;
  logout: () => void;
  setHasHydrated: (v: boolean) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      admin: null,
      _hasHydrated: false,
      setAuth: (token, admin) => set({ token, admin }),
      logout: () => {
        set({ token: null, admin: null });
        if (typeof window !== 'undefined') window.location.href = '/login';
      },
      setHasHydrated: (v) => set({ _hasHydrated: v }),
    }),
    {
      name: 'admin_auth',
      // Never persist the hydration flag itself.
      partialize: (s) => ({ token: s.token, admin: s.admin }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
