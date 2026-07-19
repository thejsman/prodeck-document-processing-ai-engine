'use client';
import { useEffect, useRef, useState } from 'react';

const TYPE_MS_PER_CHAR = 25;
const HOLD_MS = 4200;

export interface CyclingStatusText {
  text: string;
  /** True only while a phrase is being typed — the cursor should hide once the phrase is complete. */
  isTyping: boolean;
}

/**
 * Cycles through a list of phrases on a single line: types one in, holds it
 * fully written (no cursor), then starts the next phrase from the left —
 * no erase effect. Repeats for as long as `enabled`.
 */
export function useCyclingStatusText(phrases: string[], enabled: boolean): CyclingStatusText {
  const [display, setDisplay] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const indexRef = useRef(0);
  const key = phrases.join('|');

  useEffect(() => {
    if (!enabled || phrases.length === 0) {
      setDisplay('');
      setIsTyping(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function typePhrase(phrase: string, pos: number) {
      if (cancelled) return;
      setDisplay(phrase.slice(0, pos));
      if (pos < phrase.length) {
        setIsTyping(true);
        timer = setTimeout(() => typePhrase(phrase, pos + 1), TYPE_MS_PER_CHAR);
      } else {
        setIsTyping(false);
        timer = setTimeout(() => {
          indexRef.current = (indexRef.current + 1) % phrases.length;
          typePhrase(phrases[indexRef.current], 0);
        }, HOLD_MS);
      }
    }

    indexRef.current = 0;
    typePhrase(phrases[0], 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { text: display, isTyping };
}
