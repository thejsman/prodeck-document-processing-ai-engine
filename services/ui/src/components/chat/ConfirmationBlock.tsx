'use client';

import type { ConfirmationRequest } from '@/lib/use-sse';

interface ConfirmationBlockProps {
  request: ConfirmationRequest;
  /** Called when the user clicks a confirmation action (e.g. "Confirm", "Approve"). */
  onConfirm: (message: string) => void;
  /** Whether a response is in-flight (disable buttons). */
  disabled?: boolean;
}

export function ConfirmationBlock({ request, onConfirm, disabled }: ConfirmationBlockProps) {
  if (request.kind === 'confirm_entities') {
    return (
      <div className="confirmation-block confirmation-block--entities">
        <div className="confirmation-block-header">
          <span className="confirmation-block-icon">🔍</span>
          <h3 className="confirmation-block-title">Confirm extracted details</h3>
        </div>
        <div className="confirmation-block-body">
          <div className="confirmation-entity-list">
            {request.entities.map((entity) => (
              <div key={entity.field} className="confirmation-entity-row">
                <span className="confirmation-entity-label">
                  {entity.field === 'clientName' ? 'Client' : 'Industry'}
                </span>
                <span className="confirmation-entity-value">{entity.value}</span>
                <span className="confirmation-entity-source">
                  {entity.source === 'inferred' ? 'inferred' : 'from documents'}
                </span>
              </div>
            ))}
          </div>
          {request.optionalFields.length > 0 && (
            <div className="confirmation-optional-fields">
              <p className="confirmation-optional-label">Also missing (optional):</p>
              <ul className="confirmation-optional-list">
                {request.optionalFields.map((f) => (
                  <li key={f.field}>{f.question}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="confirmation-block-footer">
          <button
            type="button"
            className="confirmation-btn confirmation-btn--primary"
            onClick={() => onConfirm('yes')}
            disabled={disabled}
          >
            Confirm &amp; continue
          </button>
          <span className="confirmation-hint">or type a correction above</span>
        </div>
      </div>
    );
  }

  if (request.kind === 'confirm_template') {
    const pct = Math.round(request.confidence * 100);
    return (
      <div className="confirmation-block confirmation-block--template">
        <div className="confirmation-block-header">
          <span className="confirmation-block-icon">📄</span>
          <h3 className="confirmation-block-title">Recommended template</h3>
          <span className="confirmation-template-badge">{pct}% match</span>
        </div>
        <div className="confirmation-block-body">
          <p className="confirmation-template-name">{request.templateName}</p>
          <p className="confirmation-template-reasoning">{request.reasoning}</p>
          <div className="confirmation-template-sections">
            <p className="confirmation-sections-label">{request.sections.length} sections:</p>
            <ol className="confirmation-sections-list">
              {request.sections.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        </div>
        <div className="confirmation-block-footer">
          <button
            type="button"
            className="confirmation-btn confirmation-btn--primary"
            onClick={() => onConfirm('yes')}
            disabled={disabled}
          >
            Use this template
          </button>
          <button
            type="button"
            className="confirmation-btn confirmation-btn--secondary"
            onClick={() => onConfirm('show me other templates')}
            disabled={disabled}
          >
            Show alternatives
          </button>
        </div>
      </div>
    );
  }

  if (request.kind === 'approve_generated_template') {
    return (
      <div className="confirmation-block confirmation-block--generated">
        <div className="confirmation-block-header">
          <span className="confirmation-block-icon">✨</span>
          <h3 className="confirmation-block-title">Custom template drafted</h3>
          <span className="confirmation-template-badge confirmation-template-badge--new">New</span>
        </div>
        <div className="confirmation-block-body">
          <p className="confirmation-template-name">{request.templateName}</p>
          <div className="confirmation-template-sections">
            <p className="confirmation-sections-label">{request.sections.length} sections:</p>
            <ol className="confirmation-sections-list">
              {request.sections.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
          <a
            href={request.viewLink}
            target="_blank"
            rel="noreferrer"
            className="confirmation-view-link"
          >
            View full draft →
          </a>
        </div>
        <div className="confirmation-block-footer">
          <button
            type="button"
            className="confirmation-btn confirmation-btn--primary"
            onClick={() => onConfirm('approve')}
            disabled={disabled}
          >
            Approve &amp; generate proposal
          </button>
          <span className="confirmation-hint">or tell me what to change</span>
        </div>
      </div>
    );
  }

  return null;
}
