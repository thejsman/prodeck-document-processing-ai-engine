'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { fetchNamespaces } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface NamespaceContextValue {
  namespace: string;
  setNamespace: (ns: string) => void;
  namespaces: string[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  addNamespace: (ns: string) => void;
}

const NamespaceContext = createContext<NamespaceContextValue | null>(null);

export function NamespaceProvider({ children }: { children: ReactNode }) {
  const { apiKey } = useAuth();
  const [namespace, setNamespace] = useState('');
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNamespaces = useCallback(async () => {
    if (!apiKey) return;
    setIsLoading(true);
    setError(null);
    try {
      const ns = await fetchNamespaces(apiKey);
      setNamespaces(ns);
      setNamespace((prev) => (prev || ns[0] || ''));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    loadNamespaces();
  }, [loadNamespaces]);

  const addNamespace = useCallback((ns: string) => {
    setNamespaces((prev) => prev.includes(ns) ? prev : [...prev, ns].sort());
  }, []);

  return (
    <NamespaceContext.Provider
      value={{ namespace, setNamespace, namespaces, isLoading, error, refresh: loadNamespaces, addNamespace }}
    >
      {children}
    </NamespaceContext.Provider>
  );
}

export function useNamespace(): NamespaceContextValue {
  const ctx = useContext(NamespaceContext);
  if (!ctx) throw new Error('useNamespace must be used within NamespaceProvider');
  return ctx;
}
