'use client';

import { useState, useCallback } from 'react';
import type { LayoutAST } from '@/types/presentation';

export type PublishStatus = 'idle' | 'publishing' | 'success' | 'error';

export interface UsePublishMicrosite {
  publish: (namespace: string, ast: LayoutAST, subdomain: string) => Promise<void>;
  reset: () => void;
  status: PublishStatus;
  url: string | null;
  subdomain: string | null;
  publishedAt: string | null;
  error: string | null;
}

interface PublishResponse {
  url: string;
  subdomain: string;
  namespace: string;
  publishedAt: string;
}

interface ErrorResponse {
  error: string;
}

export function usePublishMicrosite(): UsePublishMicrosite {
  const [status, setStatus] = useState<PublishStatus>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [subdomain, setSubdomain] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback(
    async (ns: string, ast: LayoutAST, sub: string) => {
      setStatus('publishing');
      setError(null);
      try {
        const res = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ namespace: ns, ast, subdomain: sub }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as ErrorResponse | null;
          throw new Error(data?.error ?? `Publish failed (${res.status})`);
        }
        const data = (await res.json()) as PublishResponse;
        setUrl(data.url);
        setSubdomain(data.subdomain);
        setPublishedAt(data.publishedAt);
        setStatus('success');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setUrl(null);
    setSubdomain(null);
    setPublishedAt(null);
    setError(null);
  }, []);

  return { publish, reset, status, url, subdomain, publishedAt, error };
}
