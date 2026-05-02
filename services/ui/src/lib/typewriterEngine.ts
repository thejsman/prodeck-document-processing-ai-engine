'use client';

export interface TypewriterOptions {
  text: string;
  onUpdate: (current: string) => void;
  onComplete: () => void;
  /** Characters to advance per tick. Default 1. */
  charsPerTick?: number;
  /** Milliseconds between ticks. Default 30 (~33 chars/sec at 1 char/tick). */
  msPerTick?: number;
  /** Delay in ms before typing starts. */
  initialDelay?: number;
}

export interface TypewriterHandle {
  start: () => void;
  stop: () => void;
  complete: () => void;
  isRunning: () => boolean;
}

/**
 * Returns how many characters to advance per 30ms tick based on text length.
 * Keeps short/important text slow (1 char) and long body text faster (2-3 chars).
 * At 30ms/tick: 1 char → ~33 chars/sec, 2 chars → ~66/sec, 3 chars → ~100/sec.
 */
export function getCharsPerTick(textLength: number): number {
  if (textLength < 200) return 1;   // eyebrow, headline, short subheadline — deliberate
  if (textLength < 500) return 2;   // body paragraphs — comfortable flow
  return 3;                          // very long text — fast stream
}

export function createTypewriter(options: TypewriterOptions): TypewriterHandle {
  const {
    text,
    onUpdate,
    onComplete,
    charsPerTick = 1,
    msPerTick = 30,
    initialDelay = 0,
  } = options;

  let currentIndex = 0;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let done = false;

  const tick = () => {
    currentIndex = Math.min(currentIndex + charsPerTick, text.length);
    onUpdate(text.slice(0, currentIndex));
    if (currentIndex >= text.length) {
      if (timerId !== null) { clearInterval(timerId); timerId = null; }
      running = false;
      done = true;
      onComplete();
    }
  };

  return {
    start() {
      if (running || done) return;
      running = true;
      const begin = () => {
        if (!running) return;
        timerId = setInterval(tick, msPerTick);
      };
      if (initialDelay > 0) setTimeout(begin, initialDelay);
      else begin();
    },
    stop() {
      running = false;
      if (timerId !== null) { clearInterval(timerId); timerId = null; }
    },
    complete() {
      if (done) return;
      this.stop();
      done = true;
      onUpdate(text);
      onComplete();
    },
    isRunning: () => running,
  };
}
