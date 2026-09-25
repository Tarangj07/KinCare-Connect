import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getStoredUser, getAccessToken } from '../services/session';
import { getMe } from '../services/auth';

interface AuthContextValue {
  user: { id: string; email: string; fullName: string; globalRole: string } | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshAuth: () => Promise<void>;
  setUser: (user: { id: string; email: string; fullName: string; globalRole: string } | null) => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  refreshAuth: async () => {},
  setUser: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthContextValue['user']>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshAuth = useCallback(async () => {
    setIsLoading(true);
    const storedUser = await getStoredUser();
    const token = await getAccessToken();
    if (!token || !storedUser) {
      setUserState(null);
      setIsLoading(false);
      return;
    }
    try {
      const me = await getMe();
      if (me) {
        setUserState(me);
      } else {
        setUserState(storedUser);
      }
    } catch {
      setUserState(storedUser);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const setUser = useCallback((newUser: AuthContextValue['user']) => {
    setUserState(newUser);
  }, []);

  const isAuthenticated = !!user && !!(user as { id: string }).id;

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated, refreshAuth, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
