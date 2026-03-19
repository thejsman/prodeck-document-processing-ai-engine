'use client';

import { useState, useEffect, useCallback } from 'react';

interface HealthStatus {
  status: 'ok' | 'error' | 'loading';
  timestamp: string | null;
}

export function useHealth(intervalMs: number = 30000): HealthStatus {
  const [health, setHealth] = useState<HealthStatus>({
    status: 'loading',
    timestamp: null,
  });

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = (await res.json()) as { status: string; timestamp: string };
        setHealth({ status: 'ok', timestamp: data.timestamp });
      } else {
        setHealth({ status: 'error', timestamp: null });
      }
    } catch {
      setHealth({ status: 'error', timestamp: null });
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, [check, intervalMs]);

  return health;
}
