'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createTypewriter, getCharsPerTick, type TypewriterHandle } from '../lib/typewriterEngine';

export interface UseTypewriterResult {
  displayText: string;
  isTyping: boolean;
  isComplete: boolean;
  skipToEnd: () => void;
}

export function useTypewriter(
  targetText: string,
  options?: { enabled?: boolean; initialDelay?: number; onComplete?: () => void },
): UseTypewriterResult {
  const enabled = options?.enabled !== false;
  const [displayText, setDisplayText] = useState(enabled ? '' : targetText);
  const [isTyping, setIsTyping] = useState(false);
  const [isComplete, setIsComplete] = useState(!enabled);
  const handleRef = useRef<TypewriterHandle | null>(null);

  useEffect(() => {
    if (!targetText || !enabled) {
      setDisplayText(targetText);
      setIsComplete(true);
      setIsTyping(false);
      return;
    }
    setIsTyping(true);
    setIsComplete(false);
    setDisplayText('');
    const handle = createTypewriter({
      text: targetText,
      charsPerTick: getCharsPerTick(targetText.length),
      initialDelay: options?.initialDelay ?? 0,
      onUpdate: (cur) => setDisplayText(cur),
      onComplete: () => {
        setIsTyping(false);
        setIsComplete(true);
        options?.onComplete?.();
      },
    });
    handleRef.current = handle;
    handle.start();
    return () => handle.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetText, enabled]);

  const skipToEnd = useCallback(() => { handleRef.current?.complete(); }, []);

  return { displayText, isTyping, isComplete, skipToEnd };
}
