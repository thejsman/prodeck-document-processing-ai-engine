'use client';
import { useState, useEffect, useRef } from 'react';
import { createTypewriter, getCharsPerTick } from '../lib/typewriterEngine';

export interface SectionTypewriterState {
  fields: Record<string, string>;
  visibleItems: number;
  isTyping: boolean;
  isComplete: boolean;
  showCursor: boolean;
  activeField: string | null;
}

const FIELD_ORDER = ['eyebrow', 'headline', 'subheadline', 'tagline', 'body', 'description', 'statement', 'narrative', 'pullquote', 'summary'];
const ARRAY_KEYS = ['pillars', 'items', 'stats', 'phases', 'steps', 'benefits', 'painPoints', 'highlights', 'features', 'tiers', 'testimonials', 'team', 'faqs', 'comparisons', 'milestones', 'deliverables', 'metrics', 'rows', 'cards'];
const FIELD_PAUSE: Record<string, number> = { eyebrow: 120, headline: 180, subheadline: 120, tagline: 120, body: 200, description: 200, statement: 180, narrative: 200, pullquote: 250, summary: 150 };

// ms between ticks per field — lower = faster. All use 1 char/tick.
// eyebrow/headline: 40ms (~25 chars/sec) — deliberate, noticeable
// body: 18ms (~55 chars/sec) — fast flow, still readable
// pullquote: 55ms (~18 chars/sec) — dramatic, slow
const FIELD_MS_PER_TICK: Record<string, number> = {
  eyebrow: 40, headline: 35, subheadline: 28, tagline: 40,
  body: 18, description: 18, statement: 28, narrative: 18,
  pullquote: 55, summary: 28,
};

type Step =
  | { type: 'type'; key: string; text: string; msPerTick: number; charsPerTick: number }
  | { type: 'pause'; ms: number }
  | { type: 'item'; index: number };

function buildSequence(content: Record<string, unknown>): Step[] {
  const steps: Step[] = [];
  let hasAnyField = false;

  for (let i = 0; i < FIELD_ORDER.length; i++) {
    const key = FIELD_ORDER[i];
    const val = content[key];
    if (typeof val === 'string' && val.trim()) {
      if (hasAnyField) steps.push({ type: 'pause', ms: FIELD_PAUSE[key] ?? 80 });
      const msPerTick = FIELD_MS_PER_TICK[key] ?? 30;
      const charsPerTick = getCharsPerTick(val.length);
      steps.push({ type: 'type', key, text: val, msPerTick, charsPerTick });
      hasAnyField = true;
    }
  }

  for (const arrayKey of ARRAY_KEYS) {
    const arr = content[arrayKey];
    if (Array.isArray(arr) && arr.length > 0) {
      steps.push({ type: 'pause', ms: 160 });
      for (let i = 0; i < arr.length; i++) {
        steps.push({ type: 'item', index: i });
        steps.push({ type: 'pause', ms: 100 });
      }
      break; // only one array key per section
    }
  }

  return steps;
}

function buildInstantFields(content: Record<string, unknown> | null): Record<string, string> {
  if (!content) return {};
  const result: Record<string, string> = {};
  for (const key of FIELD_ORDER) {
    if (typeof content[key] === 'string') result[key] = content[key] as string;
  }
  return result;
}

function countItems(content: Record<string, unknown> | null): number {
  if (!content) return 0;
  for (const key of ARRAY_KEYS) {
    if (Array.isArray(content[key])) return (content[key] as unknown[]).length;
  }
  return 0;
}

export function useSectionTypewriter(
  content: Record<string, unknown> | null,
  options: { enabled: boolean; onComplete?: () => void },
): SectionTypewriterState {
  const [state, setState] = useState<SectionTypewriterState>(() => {
    if (!options.enabled || !content) {
      return { fields: buildInstantFields(content), visibleItems: countItems(content), isTyping: false, isComplete: true, showCursor: false, activeField: null };
    }
    return { fields: {}, visibleItems: 0, isTyping: false, isComplete: false, showCursor: false, activeField: null };
  });

  // Always keep a ref to the latest onComplete so the stale closure inside the
  // effect (which only re-runs on enabled change) always calls the current callback.
  const onCompleteRef = useRef(options.onComplete);
  onCompleteRef.current = options.onComplete;

  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!options.enabled || !content) {
      setState({ fields: buildInstantFields(content), visibleItems: countItems(content), isTyping: false, isComplete: true, showCursor: false, activeField: null });
      return;
    }

    const steps = buildSequence(content);
    if (steps.length === 0) {
      setState({ fields: buildInstantFields(content), visibleItems: countItems(content), isTyping: false, isComplete: true, showCursor: false, activeField: null });
      onCompleteRef.current?.();
      return;
    }

    setState({ fields: {}, visibleItems: 0, isTyping: true, isComplete: false, showCursor: true, activeField: null });

    let stepIdx = 0;
    let cancelled = false;
    let currentHandle: ReturnType<typeof createTypewriter> | null = null;
    let pauseTimeout: ReturnType<typeof setTimeout> | null = null;

    const runStep = () => {
      if (cancelled || stepIdx >= steps.length) {
        if (!cancelled) {
          setState(prev => ({ ...prev, isTyping: false, isComplete: true, showCursor: false, activeField: null }));
          onCompleteRef.current?.();
        }
        return;
      }

      const step = steps[stepIdx];
      stepIdx++;

      if (step.type === 'type') {
        setState(prev => ({ ...prev, activeField: step.key }));
        currentHandle = createTypewriter({
          text: step.text,
          msPerTick: step.msPerTick,
          charsPerTick: step.charsPerTick,
          onUpdate: (cur) => {
            if (!cancelled) setState(prev => ({ ...prev, fields: { ...prev.fields, [step.key]: cur } }));
          },
          onComplete: () => {
            if (!cancelled) {
              setState(prev => ({ ...prev, fields: { ...prev.fields, [step.key]: step.text } }));
              runStep();
            }
          },
        });
        currentHandle.start();
      } else if (step.type === 'pause') {
        pauseTimeout = setTimeout(() => { if (!cancelled) runStep(); }, step.ms);
      } else if (step.type === 'item') {
        setState(prev => ({ ...prev, visibleItems: step.index + 1 }));
        runStep();
      }
    };

    runStep();

    cancelRef.current = () => {
      cancelled = true;
      currentHandle?.stop();
      if (pauseTimeout) clearTimeout(pauseTimeout);
    };

    return () => {
      cancelled = true;
      currentHandle?.stop();
      if (pauseTimeout) clearTimeout(pauseTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enabled]);

  return state;
}
