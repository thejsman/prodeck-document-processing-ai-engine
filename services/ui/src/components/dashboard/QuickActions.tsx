'use client';

import Link from 'next/link';
import { Upload, FileText, MessageSquare, LayoutTemplate } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';

interface QuickAction {
  icon: React.FC<LucideProps>;
  label: string;
  href: string;
  accent?: string;
}

const ACTIONS: QuickAction[] = [
  { icon: Upload,         label: 'Upload Document', href: '/ingest',             accent: 'green'  },
  { icon: FileText,       label: 'New Proposal',    href: '/proposal',           accent: 'blue'   },
  { icon: MessageSquare,  label: 'Open Chat',       href: '/chat',               accent: 'purple' },
  { icon: LayoutTemplate, label: 'New Template',    href: '/proposal/templates', accent: 'orange' },
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
            <span className="quick-action-icon"><Icon icon={action.icon} size="md" /></span>
            <span className="quick-action-label">{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
