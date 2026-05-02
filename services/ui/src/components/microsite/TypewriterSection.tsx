'use client';
import React, { useMemo, createContext, useContext } from 'react';
import { useSectionTypewriter, type SectionTypewriterState } from '../../hooks/useSectionTypewriter';
import { TypingCursor } from './TypingCursor';

const TEXT_FIELDS = ['eyebrow', 'headline', 'subheadline', 'tagline', 'body', 'description', 'statement', 'narrative', 'pullquote', 'summary'];
const ARRAY_KEYS = ['pillars', 'items', 'stats', 'phases', 'steps', 'benefits', 'painPoints', 'highlights', 'features', 'tiers', 'testimonials', 'team', 'faqs', 'comparisons', 'milestones', 'deliverables', 'metrics', 'rows', 'cards'];

// Context so section components can access typewriter state without prop drilling
export const TypewriterStateContext = createContext<SectionTypewriterState | null>(null);

export function useTypewriterState(): SectionTypewriterState | null {
  return useContext(TypewriterStateContext);
}

/**
 * When true, ALL Reveal components skip their fade/slide-up animation and render
 * immediately visible. Set to true at the Microsite level during streaming so
 * newly-arrived sections don't play the internal IntersectionObserver-driven animations.
 */
export const SectionStreamingContext = createContext<boolean>(false);

interface TypewriterSectionProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  section: any; // LayoutAST['sections'][number]
  isActiveTyping: boolean;   // true for the section currently being typed
  isStreamingMode: boolean;  // true during any streaming
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children: (animatedSection: any, twState: SectionTypewriterState | null) => React.ReactNode;
  onComplete?: () => void;
}

export function TypewriterSection({
  section,
  isActiveTyping,
  isStreamingMode,
  children,
  onComplete,
}: TypewriterSectionProps) {
  const content = section.content as Record<string, unknown> | null;

  const twState = useSectionTypewriter(content, {
    enabled: isActiveTyping && isStreamingMode,
    onComplete,
  });

  // Build animated content — when typing is active, ALL text fields start as '' and
  // fill in progressively. This prevents the full content flashing before the typewriter starts.
  const animatedSection = useMemo(() => {
    if (!isActiveTyping || !isStreamingMode || !content) return section;
    const animated = { ...section, content: { ...content } };
    // Every known text field: use the typed partial value, or '' if not yet started
    for (const key of TEXT_FIELDS) {
      if (typeof content[key] === 'string') {
        animated.content[key] = twState.fields[key] ?? '';
      }
    }
    // Slice array fields to only show items revealed so far
    for (const key of ARRAY_KEYS) {
      if (Array.isArray(content[key])) {
        animated.content[key] = (content[key] as unknown[]).slice(0, twState.visibleItems);
      }
    }
    return animated;
  }, [isActiveTyping, isStreamingMode, section, content, twState.fields, twState.visibleItems]);

  const twStateForContext = isActiveTyping && isStreamingMode ? twState : null;

  return (
    <TypewriterStateContext.Provider value={twStateForContext}>
      <div style={{ position: 'relative' }}>
        {children(animatedSection, twStateForContext)}
        {isActiveTyping && isStreamingMode && twState.isTyping && (
          <div style={{
            position: 'absolute',
            bottom: 20,
            left: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'rgba(255,255,255,0.5)',
            pointerEvents: 'none',
            zIndex: 2,
          }}>
            <TypingCursor visible />
            <span style={{ letterSpacing: '0.03em' }}>writing…</span>
          </div>
        )}
      </div>
    </TypewriterStateContext.Provider>
  );
}
