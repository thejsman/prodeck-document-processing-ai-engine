'use client';

import { useEffect, useState } from 'react';
import { Loader } from 'lucide-react';

// Full-page loading overlay that lives in the shell layout, so it persists
// across route transitions. Pages coordinate through the module store:
// the origin page calls show() on tap, the destination page calls hide()
// when its content (e.g. a deep-linked artifact) is actually open. Because
// the element never unmounts, route-level fallbacks (loading.tsx) and page
// swaps happen invisibly behind it — one uninterrupted loader, no flicker.

let currentLabel: string | null = null;
const subscribers = new Set<(label: string | null) => void>();

export const transitionOverlay = {
  show(label: string) {
    currentLabel = label;
    subscribers.forEach((f) => f(label));
  },
  hide() {
    if (currentLabel === null) return;
    currentLabel = null;
    subscribers.forEach((f) => f(null));
  },
};

export function TransitionOverlay() {
  const [label, setLabel] = useState<string | null>(currentLabel);

  useEffect(() => {
    const f = (l: string | null) => setLabel(l);
    subscribers.add(f);
    setLabel(currentLabel);
    return () => {
      subscribers.delete(f);
    };
  }, []);

  // Safety: never strand the overlay if the destination fails to claim it
  // (load error, user navigated somewhere unrelated mid-transition).
  useEffect(() => {
    if (!label) return;
    const t = setTimeout(() => transitionOverlay.hide(), 12_000);
    return () => clearTimeout(t);
  }, [label]);

  if (!label) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <Loader size={22} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
    </div>
  );
}
