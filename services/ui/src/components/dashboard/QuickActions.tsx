'use client';

import Link from 'next/link';

interface QuickAction {
  icon: string;
  label: string;
  href: string;
  accent?: string;
}

const ACTIONS: QuickAction[] = [
  { icon: '⬆', label: 'Upload Document', href: '/ingest',             accent: 'green'  },
  { icon: '◧', label: 'New Proposal',    href: '/proposal',           accent: 'blue'   },
  { icon: '⌥', label: 'Open Chat',       href: '/chat',               accent: 'purple' },
  { icon: '☰', label: 'New Template',    href: '/proposal/templates', accent: 'orange' },
];

export function QuickActions() {
  return (
    <div className="quick-actions">
      <h3 className="quick-actions-title">Quick Actions</h3>
      <div className="quick-actions-grid">
        {ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={`quick-action-btn quick-action-btn--${action.accent}`}
          >
            <span className="quick-action-icon">{action.icon}</span>
            <span className="quick-action-label">{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
