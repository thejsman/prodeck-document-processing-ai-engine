'use client';

import { createContext, useContext } from 'react';

export interface MicrositeEffects {
  /** Hover micro-interaction tier for cards, stats, testimonials */
  hoverStyle: 'none' | 'subtle' | 'lift' | 'glow' | 'tilt';
  /** Per-section animation overrides keyed by section.id */
  sectionAnimations: Record<string, string>;
}

const defaultEffects: MicrositeEffects = {
  hoverStyle: 'lift',
  sectionAnimations: {},
};

export const MicrositeEffectsContext = createContext<MicrositeEffects>(defaultEffects);

export function useMicrositeEffects(): MicrositeEffects {
  return useContext(MicrositeEffectsContext);
}
