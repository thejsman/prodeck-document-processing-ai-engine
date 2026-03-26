'use client';

import { useEffect, useState } from 'react';
import { fetchTemplates, type TemplateInfo } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface Recommendation {
  templateId?: string;
  confidence: number;
  reasoning: string;
  fallbackGenerate: boolean;
}

interface Props {
  value: string;
  onChange: (name: string) => void;
  /** When provided, fetches a template recommendation for this namespace. */
  namespace?: string;
}

export function TemplateSelector({ value, onChange, namespace }: Props) {
  const { apiKey } = useAuth();
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recommendLoading, setRecommendLoading] = useState(false);

  // Load template list
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchTemplates(apiKey)
      .then((t) => {
        if (!cancelled) {
          setTemplates(t);
          if (t.length > 0 && !value) {
            onChange(t[0].id);
          }
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [apiKey]);

  // Fetch recommendation when namespace changes
  useEffect(() => {
    if (!namespace?.trim()) {
      setRecommendation(null);
      return;
    }

    let cancelled = false;
    setRecommendLoading(true);

    fetch(`/api/templates/recommend?namespace=${encodeURIComponent(namespace)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { recommendation?: Recommendation } | null) => {
        if (cancelled) return;
        const rec = data?.recommendation ?? null;
        setRecommendation(rec);

        // Auto-select the recommended template if user hasn't manually changed it
        if (rec?.templateId && !rec.fallbackGenerate) {
          const match = templates.find(
            (t) =>
              t.id === rec.templateId ||
              t.name.toLowerCase().replace(/\s+/g, '-') === rec.templateId,
          );
          if (match) onChange(match.id);
        }
      })
      .catch(() => { /* recommendation unavailable — leave current selection */ })
      .finally(() => { if (!cancelled) setRecommendLoading(false); });

    return () => { cancelled = true; };
  }, [namespace, apiKey, templates]);

  const selected = templates.find((t) => t.id === value);

  // Check if currently selected template matches recommendation
  const isRecommended =
    recommendation?.templateId &&
    (selected?.id === recommendation.templateId ||
      selected?.name.toLowerCase().replace(/\s+/g, '-') === recommendation.templateId);

  return (
    <div className="form-group">
      <label>
        Template
        {recommendLoading && (
          <span className="ts-scanning"> Scanning namespace…</span>
        )}
      </label>

      {loading ? (
        <p className="loading">Loading templates...</p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : templates.length === 0 ? (
        <p className="muted">No templates available</p>
      ) : (
        <>
          <select
            className="select"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {templates.map((t) => {
              const isRec = (recommendation?.templateId === t.id ||
                recommendation?.templateId === t.name.toLowerCase().replace(/\s+/g, '-')) &&
                !recommendation?.fallbackGenerate;
              return (
                <option key={t.id} value={t.id}>
                  {isRec ? `★ ${t.name} (recommended)` : `${t.name} (v${t.version})`}
                </option>
              );
            })}
          </select>

          {/* Recommendation banner */}
          {recommendation && !recommendation.fallbackGenerate && (
            <div className={`ts-rec-banner ${isRecommended ? 'ts-rec-banner--active' : 'ts-rec-banner--passive'}`}>
              <span className="ts-rec-icon">★</span>
              <div className="ts-rec-body">
                <p className="ts-rec-title">
                  {isRecommended
                    ? `Recommended — ${Math.round(recommendation.confidence * 100)}% match`
                    : `Suggested: switch to recommended template (${Math.round(recommendation.confidence * 100)}% match)`}
                </p>
                <p className="ts-rec-reason">{recommendation.reasoning}</p>
              </div>
            </div>
          )}

          {recommendation?.fallbackGenerate && (
            <div className="ts-rec-banner ts-rec-banner--fallback">
              <span className="ts-rec-icon">⚙</span>
              <div className="ts-rec-body">
                <p className="ts-rec-title">No template match — will generate custom structure</p>
                <p className="ts-rec-reason">{recommendation.reasoning}</p>
              </div>
            </div>
          )}

          {selected && (
            <div className="template-preview">
              {selected.description && <p>{selected.description}</p>}
              <ul>
                {selected.sections.map((s) => (
                  <li key={s.title}>{s.title}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
