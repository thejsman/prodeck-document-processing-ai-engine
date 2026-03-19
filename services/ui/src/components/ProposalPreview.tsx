'use client';

import ReactMarkdown from 'react-markdown';
import type { ProposalDocument } from '@/lib/api';

interface Props {
  document: ProposalDocument | null;
  isGenerating: boolean;
}

export function ProposalPreview({ document, isGenerating }: Props) {
  if (isGenerating) {
    return (
      <div className="card">
        <div className="placeholder">
          <div>
            <span className="spinner" />
            <p style={{ marginTop: 12 }}>Generating proposal sections...</p>
            <p className="muted">This may take a minute</p>
          </div>
        </div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="card">
        <div className="placeholder">
          <p className="muted">
            Configure your proposal on the left and click Generate
          </p>
        </div>
      </div>
    );
  }

  const m = document.metadata as Record<string, string | number | undefined>;

  return (
    <div className="card">
      <div className="prose">
        <ReactMarkdown>{document.content}</ReactMarkdown>
      </div>

      <div className="metadata-bar">
        {m.client ? (
          <span>
            Client: <strong>{String(m.client)}</strong>
          </span>
        ) : null}
        {m.version != null ? (
          <span>
            Version: <strong>v{String(m.version)}</strong>
          </span>
        ) : null}
        {m.template ? (
          <span>
            Template: <strong>{String(m.template)}</strong>
          </span>
        ) : null}
        {m.sections != null ? (
          <span>
            Sections: <strong>{String(m.sections)}</strong>
          </span>
        ) : null}
        {m.source_documents != null ? (
          <span>
            Sources: <strong>{String(m.source_documents)}</strong>
          </span>
        ) : null}
        {m.retrieval_mode ? (
          <span>
            Retrieval: <strong>{String(m.retrieval_mode)}</strong>
          </span>
        ) : null}
        {m.pricing_mode ? (
          <span>
            Pricing: <strong>{String(m.pricing_mode)}</strong>
          </span>
        ) : null}
      </div>
    </div>
  );
}
