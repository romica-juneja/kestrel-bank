import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, setUnauthorizedHandler } from '../api/client';
import type { Customer } from '../api/types';

interface AuthState {
  customer: Customer | null;
  checking: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setCustomer(null));
    api
      .me()
      .then((r) => setCustomer(r.customer))
      .catch(() => setCustomer(null))
      .finally(() => setChecking(false));
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const r = await api.login(username, password);
    setCustomer(r.customer);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      sessionStorage.clear(); // drop any transfer draft
      setCustomer(null);
    }
  }, []);

  const value = useMemo(() => ({ customer, checking, signIn, signOut }), [customer, checking, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Protected screens render only for a signed-in customer; everyone else goes to sign in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { customer, checking } = useAuth();
  const location = useLocation();
  if (checking) return <p className="status-line" role="status">Loading…</p>;
  if (!customer) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
