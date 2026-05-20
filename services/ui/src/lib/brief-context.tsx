'use client';

import { createContext, useContext } from 'react';
import type { useBrief } from '@/hooks/useBrief';

export type BriefContextValue = ReturnType<typeof useBrief>;

export const BriefContext = createContext<BriefContextValue | null>(null);

export function useBriefContext(): BriefContextValue {
  const ctx = useContext(BriefContext);
  if (!ctx) throw new Error('useBriefContext must be used within BriefContext.Provider');
  return ctx;
}
