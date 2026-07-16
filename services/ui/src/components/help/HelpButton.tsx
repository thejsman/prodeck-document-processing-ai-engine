'use client';

import { HelpCircle } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useHelp } from '@/lib/help/help-store';

interface Props {
  variant?: 'sidebar' | 'icon' | 'fab';
  topicId?: string;
  /** Hide the text label (e.g. collapsed sidebar). */
  collapsed?: boolean;
  label?: string;
}

/**
 * Reusable Help trigger. Opens the context-aware drawer (no topicId) or a
 * specific topic. `sidebar` matches the sidebar-link look; `icon` is a bare
 * icon button; `fab` is the floating action button (see HelpLauncher).
 */
export function HelpButton({ variant = 'icon', topicId, collapsed = false, label = 'Help & FAQ' }: Props) {
  const openHelp = useHelp((s) => s.openHelp);
  const onClick = () => openHelp(topicId);

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        className="sidebar-link help-sidebar-link"
        onClick={onClick}
        title={label}
        aria-label={label}
      >
        <Icon icon={HelpCircle} size="md" className="sidebar-icon" />
        {!collapsed && <span className="sidebar-label">{label}</span>}
      </button>
    );
  }

  if (variant === 'fab') {
    return (
      <button type="button" className="help-fab" onClick={onClick} aria-label={label} title={`${label} (?)`}>
        <Icon icon={HelpCircle} size="lg" />
      </button>
    );
  }

  return (
    <button type="button" className="help-icon-btn" onClick={onClick} aria-label={label} title={label}>
      <Icon icon={HelpCircle} size="md" />
    </button>
  );
}
