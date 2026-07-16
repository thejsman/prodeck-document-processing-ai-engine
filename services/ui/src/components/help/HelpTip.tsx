'use client';

import { HelpCircle } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useHelp } from '@/lib/help/help-store';

type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  /** Topic id to open in the Help drawer. */
  topicId: string;
  size?: IconSize;
  label?: string;
  className?: string;
}

/**
 * Inline "?" affordance placed next to a feature or section header. Clicking it
 * opens the Help drawer pinned to `topicId`.
 */
export function HelpTip({ topicId, size = 'sm', label = 'Help', className }: Props) {
  const openHelp = useHelp((s) => s.openHelp);
  return (
    <button
      type="button"
      className={`help-tip${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        openHelp(topicId);
      }}
    >
      <Icon icon={HelpCircle} size={size} />
    </button>
  );
}
