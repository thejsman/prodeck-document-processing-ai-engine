'use client';

import { useEffect, useRef, useState } from 'react';

interface StatCardProps {
  icon: string;
  label: string;
  value: number;
  trend?: string;
  accent?: 'blue' | 'green' | 'purple' | 'orange';
  loading?: boolean;
}

function useCountUp(target: number, duration = 600): number {
  const [count, setCount] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // cubic ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(eased * target));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);

  return count;
}

export function StatCard({ icon, label, value, trend, accent = 'blue', loading = false }: StatCardProps) {
  const display = useCountUp(loading ? 0 : value);

  return (
    <div className={`stat-card stat-card--${accent}`}>
      <div className="stat-card-accent" />
      <div className="stat-card-body">
        <span className="stat-card-icon">{icon}</span>
        <div className="stat-card-content">
          <span className="stat-card-label">{label}</span>
          <span className="stat-card-value">
            {loading ? <span className="stat-card-skeleton" /> : display}
          </span>
          {trend && !loading && (
            <span className="stat-card-trend">{trend}</span>
          )}
        </div>
      </div>
    </div>
  );
}
