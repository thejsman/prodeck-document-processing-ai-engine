'use client';

import { useState, useCallback, useRef } from 'react';
import type { LayoutAST } from '@/types/presentation';
import { savePublishMeta } from '@/lib/api';

export type CustomDomainPublishStatus =
  | 'idle'
  | 'publishing'
  | 'polling-ssl'
  | 'success'
  | 'error';

export interface UseCustomDomainPublish {
  publish: (
    namespace: string,
    ast: LayoutAST,
    domain: string,
    proposalId: string,
    apiKey: string,
    password?: string,
  ) => Promise<void>;
  reset: () => void;
  restoreFromMeta: (meta: { customDomain: string; url: string; publishedAt: string; passwordProtected?: boolean }) => void;
  status: CustomDomainPublishStatus;
  url: string | null;
  domain: string | null;
  publishedAt: string | null;
  passwordProtected: boolean;
  sslReady: boolean;
  error: string | null;
}

interface PublishResponse {
  url: string;
  domain: string;
  namespace: string;
  publishedAt: string;
  passwordProtected?: boolean;
  sslPending?: boolean;
}

interface ErrorResponse {
  error: string;
}

export function useCustomDomainPublish(): UseCustomDomainPublish {
  const [status, setStatus] = useState<CustomDomainPublishStatus>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [sslReady, setSslReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopPolling() {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function pollSsl(domainName: string, deadline: number) {
    if (Date.now() >= deadline) {
      // Timed out but site is live — SSL just isn't ready yet. Still succeed.
      setSslReady(false);
      setStatus('success');
      return;
    }
    pollTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/check-custom-domain-ssl?domain=${encodeURIComponent(domainName)}`);
        const data = (await res.json()) as { hasCert: boolean; unmanaged?: boolean };
        if (data.hasCert || data.unmanaged) {
          setSslReady(true);
          setStatus('success');
        } else {
          pollSsl(domainName, deadline);
        }
      } catch {
        pollSsl(domainName, deadline);
      }
    }, 3000);
  }

  const publish = useCallback(
    async (
      ns: string,
      ast: LayoutAST,
      domainName: string,
      proposalId: string,
      apiKey: string,
      password?: string,
    ) => {
      stopPolling();
      setStatus('publishing');
      setError(null);
      setSslReady(false);
      try {
        const res = await fetch('/api/publish-custom-domain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ namespace: ns, ast, domain: domainName, password }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as ErrorResponse | null;
          throw new Error(data?.error ?? `Publish failed (${res.status})`);
        }
        const data = (await res.json()) as PublishResponse;
        setUrl(data.url);
        setDomain(data.domain);
        setPublishedAt(data.publishedAt);
        setPasswordProtected(!!data.passwordProtected);

        savePublishMeta(apiKey, ns, proposalId, {
          customDomain: data.domain,
          url: data.url,
          publishedAt: data.publishedAt,
        } as Parameters<typeof savePublishMeta>[3]).catch(() => { /* non-fatal */ });

        if (data.sslPending) {
          setStatus('polling-ssl');
          // Poll for up to 2 minutes
          pollSsl(data.domain, Date.now() + 120_000);
        } else {
          setSslReady(true);
          setStatus('success');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const reset = useCallback(() => {
    stopPolling();
    setStatus('idle');
    setUrl(null);
    setDomain(null);
    setPublishedAt(null);
    setPasswordProtected(false);
    setSslReady(false);
    setError(null);
  }, []);

  const restoreFromMeta = useCallback((meta: { customDomain: string; url: string; publishedAt: string; passwordProtected?: boolean }) => {
    setUrl(meta.url);
    setDomain(meta.customDomain);
    setPublishedAt(meta.publishedAt);
    setPasswordProtected(meta.passwordProtected ?? false);
    setSslReady(true);
    setStatus('success');
  }, []);

  return { publish, reset, restoreFromMeta, status, url, domain, publishedAt, passwordProtected, sslReady, error };
}
