'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders help/FAQ markdown consistently: GitHub-flavored markdown inside the
 * shared `.prose` typography wrapper. All help copy flows through here.
 */
export function HelpMarkdown({ children }: { children: string }) {
  return (
    <div className="prose help-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
