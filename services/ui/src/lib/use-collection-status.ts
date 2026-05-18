// services/ui/src/lib/use-collection-status.ts
//
// React hook for polling the client data collection status.
// Used by the right panel to show live progress as the user
// provides data through chat, file uploads, or URL scraping.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './auth-context';
import { useNamespace } from './namespace-context';

// ---------------------------------------------------------------------------
// Types (mirrors the API response from GET /collection/status)
// ---------------------------------------------------------------------------

export interface IndustryField {
  key: string;
  label: string;
  question: string;
  priority: 'must_have' | 'should_have' | 'nice_to_have';
  category: string;
}

export interface BrandColor {
  hex: string;
  usage: string;
  confidence: number;
}

export interface BrandTypography {
  fontFamily: string;
  usage: string;
  confidence: number;
}

export interface BrandingKit {
  logoUrl?: string;
  colors: BrandColor[];
  typography: BrandTypography[];
  visualTone?: string;
  source: string;
  extractedAt: string;
}

export interface IndustryContext {
  industryId: string | null;
  engagementType: string | null;
  detectedAt: string;
  detectedFrom: string;
  confidence: number;
}

export interface CollectionStatus {
  baseFieldsFilled: string[];
  baseFieldsMissing: string[];
  industryFieldsFilled: string[];
  industryFieldsMissing: IndustryField[];
  industryDetected: boolean;
  industryName: string | null;
  engagementType: string | null;
  baseCompleteness: number;
  industryCompleteness: number;
  overallCompleteness: number;
  proposalReady: boolean;
  hasBranding: boolean;
  summary: string;
  nextQuestions: IndustryField[];
  brandingKit: BrandingKit | null;
  industryContext: IndustryContext | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = '/api';

export function useCollectionStatus(pollInterval = 5000) {
  const { apiKey } = useAuth();
  const { namespace } = useNamespace();
  const [status, setStatus] = useState<CollectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!namespace || !apiKey) return;

    try {
      const res = await fetch(`${API_BASE}/namespaces/${namespace}/collection/status`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        setError(`Status fetch failed: ${res.status}`);
        return;
      }
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      setLoading(false);
    }
  }, [namespace, apiKey]);

  // Initial fetch
  useEffect(() => {
    if (!namespace) {
      setStatus(null);
      return;
    }
    setLoading(true);
    fetchStatus();
  }, [namespace, fetchStatus]);

  // Polling
  useEffect(() => {
    if (!namespace) return;

    intervalRef.current = setInterval(fetchStatus, pollInterval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [namespace, fetchStatus, pollInterval]);

  // Manual refresh (call after chat messages, file uploads, etc.)
  const refresh = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { status, loading, error, refresh };
}
