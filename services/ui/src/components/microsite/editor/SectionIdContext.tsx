'use client';

import { createContext, useContext, type ReactNode } from 'react';

const SectionIdContext = createContext<string | null>(null);

export function useSectionId(): string | null {
  return useContext(SectionIdContext);
}

export function SectionIdProvider({ id, children }: { id: string; children: ReactNode }) {
  return <SectionIdContext.Provider value={id}>{children}</SectionIdContext.Provider>;
}
