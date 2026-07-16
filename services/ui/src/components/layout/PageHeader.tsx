import type { ReactNode } from 'react';
import { HelpTip } from '@/components/help/HelpTip';

interface Props {
  title: string;
  subtitle?: string;
  rightAction?: ReactNode;
  /** When set, renders an inline "?" tip next to the title that opens this help topic. */
  helpTopicId?: string;
}

/**
 * Standardised page header — large title, optional subtitle, optional
 * right-aligned action slot (e.g. a primary CTA button), and an optional
 * inline Help "?" tip beside the title.
 */
export function PageHeader({ title, subtitle, rightAction, helpTopicId }: Props) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <div className="page-header-title-row">
          <h1>{title}</h1>
          {helpTopicId && <HelpTip topicId={helpTopicId} size="md" label={`Help: ${title}`} />}
        </div>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {rightAction && <div className="page-header-action">{rightAction}</div>}
    </div>
  );
}
