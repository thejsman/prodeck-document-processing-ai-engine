'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ExecutionDrawer } from '@/components/system/ExecutionDrawer';
import { ExecutionTransportManager } from '@/components/system/ExecutionTransportManager';
import { HelpDrawer } from '@/components/help/HelpDrawer';
import { HelpLauncher } from '@/components/help/HelpLauncher';
import { useMobileNav } from '@/lib/mobile-nav-store';

interface Props {
  children: ReactNode;
}

export function ShellLayout({ children }: Props) {
  const { mobileOpen, openMobileNav, closeMobileNav } = useMobileNav();

  return (
    <div className="shell">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={closeMobileNav}
      />

      {/* Mobile backdrop — closes sidebar when tapped */}
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={closeMobileNav}
          aria-hidden="true"
        />
      )}

      <div className="shell-main">
        <Topbar onMenuClick={openMobileNav} />
        <main className="shell-content">{children}</main>
      </div>

      <ExecutionDrawer />
      <ExecutionTransportManager />
      <HelpDrawer />
      <HelpLauncher />
    </div>
  );
}
