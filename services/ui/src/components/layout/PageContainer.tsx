import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Pass "narrow" for single-column content pages (max 860px). */
  narrow?: boolean;
}

/**
 * Standardised page wrapper.
 * Centres content with a max-width of 1400px (860px when narrow=true),
 * horizontal padding that collapses on mobile, and consistent vertical
 * section rhythm.
 */
export function PageContainer({ children, narrow = false }: Props) {
  return (
    <div className={`page-container${narrow ? ' page-container--narrow' : ''}`}>
      {children}
    </div>
  );
}
