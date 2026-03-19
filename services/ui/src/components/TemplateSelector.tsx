'use client';

import { useEffect, useState } from 'react';
import { fetchTemplates, type TemplateInfo } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface Props {
  value: string;
  onChange: (name: string) => void;
}

export function TemplateSelector({ value, onChange }: Props) {
  const { apiKey } = useAuth();
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchTemplates(apiKey)
      .then((t) => {
        if (!cancelled) {
          setTemplates(t);
          if (t.length > 0 && !value) {
            onChange(t[0].name);
          }
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  const selected = templates.find((t) => t.name === value);

  return (
    <div className="form-group">
      <label>Template</label>
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
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} (v{t.version})
              </option>
            ))}
          </select>
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
