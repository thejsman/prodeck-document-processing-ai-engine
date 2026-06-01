'use client';

import { createContext, useContext } from 'react';
import type { MotionLevel } from '@/types/presentation';

export interface MicrositeEffects {
  /** Hover micro-interaction tier for cards, stats, testimonials */
  hoverStyle: 'none' | 'subtle' | 'lift' | 'glow' | 'tilt';
  /** Per-section animation overrides keyed by section.id */
  sectionAnimations: Record<string, string>;
  /** Motion intensity level driven by user prompt / AST */
  motionLevel: MotionLevel;
}

const defaultEffects: MicrositeEffects = {
  hoverStyle: 'lift',
  sectionAnimations: {},
  motionLevel: 'standard',
};

export const MicrositeEffectsContext = createContext<MicrositeEffects>(defaultEffects);

export function useMicrositeEffects(): MicrositeEffects {
  return useContext(MicrositeEffectsContext);
}

export function useMotionLevel(): MotionLevel {
  return useContext(MicrositeEffectsContext).motionLevel;
}
