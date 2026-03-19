'use client';

import Link from 'next/link';

export default function AdminPage() {
  return (
    <>
      <div className="page-header">
        <h1>Administration</h1>
      </div>

      <nav className="admin-nav">
        <Link href="/admin/namespaces" className="admin-nav-card card">
          <span className="admin-nav-icon">&#x2630;</span>
          <span className="admin-nav-label">Namespaces</span>
          <span className="muted">Create and manage namespaces</span>
        </Link>
        <Link href="/admin/memory" className="admin-nav-card card">
          <span className="admin-nav-icon">&#x1F9E0;</span>
          <span className="admin-nav-label">Memory</span>
          <span className="muted">View and edit namespace memory</span>
        </Link>
        <Link href="/admin/config" className="admin-nav-card card">
          <span className="admin-nav-icon">&#x2699;</span>
          <span className="admin-nav-label">Configuration</span>
          <span className="muted">Manage namespace pipeline configuration</span>
        </Link>
      </nav>
    </>
  );
}
