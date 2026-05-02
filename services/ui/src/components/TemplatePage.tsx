'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { fetchTemplate } from '@/lib/api';
import type { TemplateSection } from '@/lib/api';

export function TemplatePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { apiKey } = useAuth();

  const artifact = searchParams.get('artifact');
  const namespace = searchParams.get('namespace');
  const fromChat = searchParams.get('from') === 'chat';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [sections, setSections] = useState<TemplateSection[]>([]);

  useEffect(() => {
    if (!artifact || !apiKey) return;

    const slug = artifact.replace(/\.ya?ml$/, '');
    setLoading(true);
    setError(null);

    fetchTemplate(apiKey, slug)
      .then((detail) => {
        setTemplateName(detail.parsed.name || slug);
        setTemplateDescription(detail.parsed.description || '');
        setSections(detail.parsed.sections || []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load template');
      })
      .finally(() => setLoading(false));
  }, [artifact, apiKey]);

  const handleBackToChat = () => {
    if (namespace) {
      router.push(`/chat?namespace=${encodeURIComponent(namespace)}`);
    } else {
      router.back();
    }
  };

  if (!artifact) {
    return (
      <div className="template-page-error">
        <p>No template specified. Missing <code>artifact</code> parameter.</p>
      </div>
    );
  }

  return (
    <div className="template-page">
      <div className="template-page-header">
        <div className="template-page-header-left">
          {fromChat && (
            <button
              type="button"
              className="template-page-back-btn"
              onClick={handleBackToChat}
            >
              ← Back to Chat
            </button>
          )}
          <div className="template-page-title-block">
            <h1 className="template-page-title">
              {loading ? 'Loading template…' : templateName}
            </h1>
            {!loading && templateDescription && (
              <p className="template-page-description">{templateDescription}</p>
            )}
          </div>
        </div>
        {fromChat && !loading && (
          <div className="template-page-actions">
            <p className="template-page-approve-hint">
              Return to chat and type <strong>"approve"</strong> to use this template.
            </p>
          </div>
        )}
      </div>

      <div className="template-page-body">
        {loading && (
          <div className="template-page-loading">
            <div className="template-page-spinner" />
            <span>Loading template sections…</span>
          </div>
        )}

        {error && (
          <div className="template-page-error-msg">
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && sections.length === 0 && (
          <div className="template-page-empty">
            <p>This template has no sections defined.</p>
          </div>
        )}

        {!loading && !error && sections.length > 0 && (
          <div className="template-sections-grid">
            {sections.map((section, index) => (
              <div key={section.title} className="template-section-card">
                <div className="template-section-card-header">
                  <span className="template-section-number">{index + 1}</span>
                  <h2 className="template-section-title">{section.title}</h2>
                </div>
                <div className="template-section-card-body">
                  {section.instruction && (
                    <div className="template-section-field">
                      <span className="template-section-label">Writing guide</span>
                      <p className="template-section-value">{section.instruction}</p>
                    </div>
                  )}
                  {section.query && (
                    <div className="template-section-field">
                      <span className="template-section-label">Search query</span>
                      <p className="template-section-value template-section-query">{section.query}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
