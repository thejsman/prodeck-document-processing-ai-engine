'use client';

import { NamespaceManager } from '@/components/NamespaceManager';

export default function NamespacesPage() {
  return (
    <>
      <div className="page-header">
        <h1>Namespaces</h1>
        <p className="muted">Create and view namespaces for organizing documents and memory.</p>
      </div>
      <NamespaceManager />
    </>
  );
}
