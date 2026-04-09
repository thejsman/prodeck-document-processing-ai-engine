'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

interface AuthContextValue {
  apiKey: string;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'ai-engine-api-key';

export function AuthProvider({ children }: { children: ReactNode }) {
  // Read synchronously so the first render already has the correct value.
  // The lazy initializer is skipped on the server (window is undefined),
  // which keeps SSR output stable; on the client it reads localStorage
  // immediately — no extra render cycle, no null flash.
  const [apiKey, setApiKeyState] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(STORAGE_KEY) || 'admin-key';
  });

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    localStorage.setItem(STORAGE_KEY, key);
  }, []);

  const clearApiKey = useCallback(() => {
    setApiKeyState('');
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider
      value={{ apiKey, setApiKey, clearApiKey, isAuthenticated: !!apiKey }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
