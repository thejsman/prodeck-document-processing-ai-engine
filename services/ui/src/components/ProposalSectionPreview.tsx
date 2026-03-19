'use client';

import ReactMarkdown from 'react-markdown';

interface Props {
  sectionTitle: string;
  originalContent: string;
  rewrittenContent: string;
  onAccept: () => void;
  onDiscard: () => void;
}

export function ProposalSectionPreview({
  sectionTitle,
  originalContent,
  rewrittenContent,
  onAccept,
  onDiscard,
}: Props) {
  return (
    <div className="ai-preview-overlay" onClick={onDiscard}>
      <div className="ai-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ai-preview-header">
          <h3>Review Rewrite</h3>
          <span className="ai-editor-section-name">{sectionTitle}</span>
        </div>

        <div className="ai-preview-body">
          <div className="ai-preview-column">
            <div className="ai-preview-column-label">Original</div>
            <div className="ai-preview-content ai-preview-content--original">
              <ReactMarkdown>{originalContent}</ReactMarkdown>
            </div>
          </div>
          <div className="ai-preview-column">
            <div className="ai-preview-column-label">Rewritten</div>
            <div className="ai-preview-content ai-preview-content--rewritten">
              <ReactMarkdown>{rewrittenContent}</ReactMarkdown>
            </div>
          </div>
        </div>

        <div className="ai-preview-footer">
          <button className="btn btn-sm" onClick={onDiscard}>
            Discard
          </button>
          <button className="btn btn-sm btn-primary" onClick={onAccept}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
