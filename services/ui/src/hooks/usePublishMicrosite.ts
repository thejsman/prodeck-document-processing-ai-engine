'use client';

import { useState, useCallback } from 'react';
import type { LayoutAST } from '@/types/presentation';
import { savePublishMeta } from '@/lib/api';

export type PublishStatus = 'idle' | 'publishing' | 'success' | 'error';

export interface UsePublishMicrosite {
  publish: (namespace: string, ast: LayoutAST, subdomain: string, proposalId: string, apiKey: string, password?: string) => Promise<void>;
  reset: () => void;
  restoreFromMeta: (meta: { subdomain?: string; url: string; publishedAt: string; passwordProtected?: boolean }) => void;
  status: PublishStatus;
  url: string | null;
  subdomain: string | null;
  publishedAt: string | null;
  passwordProtected: boolean;
  error: string | null;
}

interface PublishResponse {
  url: string;
  subdomain: string;
  namespace: string;
  publishedAt: string;
  passwordProtected?: boolean;
}

interface ErrorResponse {
  error: string;
}

export function usePublishMicrosite(): UsePublishMicrosite {
  const [status, setStatus] = useState<PublishStatus>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [subdomain, setSubdomain] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback(
    async (ns: string, ast: LayoutAST, sub: string, proposalId: string, apiKey: string, password?: string) => {
      setStatus('publishing');
      setError(null);
      try {
        const res = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ namespace: ns, ast, subdomain: sub, password }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as ErrorResponse | null;
          throw new Error(data?.error ?? `Publish failed (${res.status})`);
        }
        const data = (await res.json()) as PublishResponse;
        setUrl(data.url);
        setSubdomain(data.subdomain);
        setPublishedAt(data.publishedAt);
        setPasswordProtected(!!data.passwordProtected);
        setStatus('success');
        // Persist so any browser/user can see the previously published URL
        savePublishMeta(apiKey, ns, proposalId, {
          subdomain: data.subdomain,
          url: data.url,
          publishedAt: data.publishedAt,
        }).catch(() => { /* non-fatal */ });
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
    setPasswordProtected(false);
    setError(null);
  }, []);

  const restoreFromMeta = useCallback((meta: { subdomain?: string; url: string; publishedAt: string; passwordProtected?: boolean }) => {
    if (!meta.subdomain) return; // custom domain publish — not for this hook
    setUrl(meta.url);
    setSubdomain(meta.subdomain);
    setPublishedAt(meta.publishedAt);
    setPasswordProtected(meta.passwordProtected ?? false);
    setStatus('success');
  }, []);

  return { publish, reset, restoreFromMeta, status, url, subdomain, publishedAt, passwordProtected, error };
}
