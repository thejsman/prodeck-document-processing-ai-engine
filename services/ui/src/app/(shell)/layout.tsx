'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { NamespaceProvider } from '@/lib/namespace-context';
import { ApiKeyGate } from '@/components/ApiKeyGate';
import { ShellLayout } from '@/components/shell/ShellLayout';

export default function ShellRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, setApiKey } = useAuth();

  // Suppress the auth-gate flash: server renders null (no window/localStorage),
  // client matches that on first hydration pass, then immediately re-renders
  // with the correct state after mount. One clean transition, no wrong content.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  if (!isAuthenticated) {
    return <ApiKeyGate onSubmit={setApiKey} />;
  }

  return (
    <NamespaceProvider>
      <ShellLayout>{children}</ShellLayout>
    </NamespaceProvider>
  );
}
