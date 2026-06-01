'use client';

import { useEffect, useRef, useState } from 'react';
import { validateSubdomain } from '@/lib/subdomainValidation';

export type CheckStatus = 'idle' | 'checking' | 'available' | 'unavailable';

export interface SubdomainCheckState {
  status: CheckStatus;
  message: string | null;
}

const DEBOUNCE_MS = 400;

interface CheckResponse {
  available: boolean;
  reason?: 'taken' | 'invalid' | 'reserved';
  message?: string;
}

export function useSubdomainCheck(subdomain: string): SubdomainCheckState {
  const [state, setState] = useState<SubdomainCheckState>({ status: 'idle', message: null });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    if (!subdomain) {
      setState({ status: 'idle', message: null });
      return;
    }

    // Client-side format pre-check — avoids a network round-trip for obvious errors
    const v = validateSubdomain(subdomain);
    if (!v.ok) {
      setState({ status: 'unavailable', message: v.message });
      return;
    }

    setState({ status: 'checking', message: null });
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/check-subdomain?subdomain=${encodeURIComponent(subdomain)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          setState({ status: 'available', message: null }); // fail-open
          return;
        }
        const data = (await res.json()) as CheckResponse;
        if (controller.signal.aborted) return;
        if (data.available) {
          setState({ status: 'available', message: null });
        } else {
          setState({ status: 'unavailable', message: data.message ?? 'Not available' });
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        // Network error → fail-open so the UI doesn't block the user
        setState({ status: 'available', message: null });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [subdomain]);

  return state;
}
