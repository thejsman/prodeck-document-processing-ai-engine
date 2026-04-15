'use client';

import { useEffect, useState } from 'react';
import { fetchNamespaces } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface Props {
  value: string;
  onChange: (ns: string) => void;
}

export function NamespaceSelector({ value, onChange }: Props) {
  const { apiKey } = useAuth();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchNamespaces(apiKey)
      .then((ns) => {
        if (!cancelled) {
          setNamespaces(ns);
          if (!value && ns.length > 0) onChange(ns[0]);
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

  return (
    <div className="form-group">
      <label>Project (for RAG context)</label>
      {loading ? (
        <p className="loading">Loading projects...</p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : (
        <select
          className="select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">(none)</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
