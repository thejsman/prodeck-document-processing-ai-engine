'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ExecutionDrawer } from '@/components/system/ExecutionDrawer';
import { ExecutionTransportManager } from '@/components/system/ExecutionTransportManager';

interface Props {
  children: ReactNode;
}

export function ShellLayout({ children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="shell">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Mobile backdrop — closes sidebar when tapped */}
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="shell-main">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="shell-content">{children}</main>
      </div>

      <ExecutionDrawer />
      <ExecutionTransportManager />
    </div>
  );
}
