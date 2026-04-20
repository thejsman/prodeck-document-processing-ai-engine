'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NamespacesSection } from './NamespacesSection';
import { Globe, FileText, MoreVertical } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';

const OVERFLOW_ITEMS = [
  { href: '/proposal/templates', label: 'Templates' },
  { href: '/chat',               label: 'Chat' },
  { href: '/',                   label: 'Dashboard' },
];

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const { clearApiKey } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const sidebarClass = ['sidebar', mobileOpen ? 'sidebar--mobile-open' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <aside className={sidebarClass}>

      {/* ── Header ── */}
      <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center' }}>
        <Link href="/" className="sidebar-brand" style={{ textDecoration: 'none' }}>ProDeck</Link>
      </div>

      {/* ── Navigation ── */}
      <nav className="sidebar-nav">
        <div className="sidebar-group">
          <Link
            href="/proposal"
            className={`sidebar-link${pathname?.startsWith('/proposal') ? ' sidebar-link--active' : ''}`}
            onClick={onMobileClose}
          >
            <Icon icon={FileText} size="md" className="sidebar-icon" />
            <span className="sidebar-label">Proposals</span>
          </Link>
          <Link
            href="/presentation"
            className={`sidebar-link${pathname?.startsWith('/presentation') ? ' sidebar-link--active' : ''}`}
            onClick={onMobileClose}
          >
            <Icon icon={Globe} size="md" className="sidebar-icon" />
            <span className="sidebar-label">Microsites</span>
          </Link>
        </div>

        <NamespacesSection onMobileClose={onMobileClose} />
      </nav>

      {/* ── Footer ── */}
      <div className="sidebar-footer" ref={menuRef} style={{ position: 'relative' }}>

        {/* Overflow menu */}
        {menuOpen && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 4px)',
            left: 8, right: 8,
            background: 'var(--panel)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '4px 0', zIndex: 200,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          }}>
            {OVERFLOW_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className="sidebar-link"
                style={{ borderRadius: 0, height: 36, paddingLeft: 14 }}
                onClick={() => { setMenuOpen(false); onMobileClose(); }}
              >
                <span className="sidebar-label" style={{ fontSize: 13 }}>{item.label}</span>
              </Link>
            ))}
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <button
              className="sidebar-link"
              style={{ borderRadius: 0, height: 36, paddingLeft: 14, width: '100%', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)' }}
              onClick={() => { setMenuOpen(false); clearApiKey(); }}
            >
              <span className="sidebar-label" style={{ fontSize: 13, color: 'var(--danger)' }}>Disconnect</span>
            </button>
          </div>
        )}

        {/* User row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            background: 'var(--primary)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 600, lineHeight: 1.5, letterSpacing: '0.01em',
          }}>A</div>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 400, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Admin
          </span>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px', display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}
            aria-label="User menu"
          >
            <Icon icon={MoreVertical} size="md" />
          </button>
        </div>
      </div>

    </aside>
  );
}
