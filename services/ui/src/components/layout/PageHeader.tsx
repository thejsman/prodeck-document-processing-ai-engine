import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  rightAction?: ReactNode;
}

/**
 * Standardised page header — large title, optional subtitle, optional
 * right-aligned action slot (e.g. a primary CTA button).
 */
export function PageHeader({ title, subtitle, rightAction }: Props) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {rightAction && <div className="page-header-action">{rightAction}</div>}
    </div>
  );
}
