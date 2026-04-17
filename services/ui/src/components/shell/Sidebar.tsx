'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileText, LayoutTemplate, Globe, Upload, MessageSquare, Settings, ChevronRight, ChevronLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Nav structure ─────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  /** Undefined = no label (top-level items) */
  label?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ href: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'WORKSPACE',
    items: [
      { href: '/proposal', label: 'Proposals', icon: FileText },
      { href: '/proposal/templates', label: 'Templates', icon: LayoutTemplate },
      { href: '/presentation', label: 'Microsite', icon: Globe },
      { href: '/ingest', label: 'Ingest', icon: Upload },
    ],
  },
  {
    label: 'AI',
    items: [{ href: '/chat', label: 'Chat', icon: MessageSquare }],
  },
  {
    label: 'ADMIN',
    items: [{ href: '/admin', label: 'Admin', icon: Settings }],
  },
];

// ── Helpers ───────────────────────────────────────────────────────

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function getIsActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  const matches = pathname === href || pathname.startsWith(href + '/');
  const hasMoreSpecificChild = ALL_ITEMS.some(
    (item) =>
      item.href !== href &&
      item.href.startsWith(href + '/') &&
      (pathname === item.href || pathname.startsWith(item.href + '/')),
  );
  return matches && !hasMoreSpecificChild;
}

// ── Component ─────────────────────────────────────────────────────

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Restore collapse preference from localStorage (client-only)
  useEffect(() => {
    try {
      if (localStorage.getItem('sidebar-collapsed') === 'true') {
        setCollapsed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar-collapsed', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const sidebarClass = ['sidebar', collapsed ? 'sidebar--collapsed' : '', mobileOpen ? 'sidebar--mobile-open' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <aside className={sidebarClass}>
      {/* Header */}
      <div className="sidebar-header">
        {collapsed ? <span className="sidebar-brand-icon">P</span> : <span className="sidebar-brand">ProDeck</span>}
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className="sidebar-group">
            {group.label && !collapsed && <span className="sidebar-group-label">{group.label}</span>}
            {group.items.map((item) => {
              const active = getIsActive(item.href, pathname);
              const NavIcon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`sidebar-link${active ? ' sidebar-link--active' : ''}`}
                  title={collapsed ? item.label : undefined}
                  onClick={onMobileClose}
                >
                  <span className="sidebar-icon"><NavIcon size={16} strokeWidth={1.5} /></span>
                  {!collapsed && <span className="sidebar-label">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer toggle */}
      <div className="sidebar-footer">
        <button
          className="sidebar-toggle"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <span className="sidebar-icon">
            {collapsed ? <ChevronRight size={16} strokeWidth={1.5} /> : <ChevronLeft size={16} strokeWidth={1.5} />}
          </span>
          {!collapsed && <span className="sidebar-label">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
