'use client';

import { useEffect, useRef } from 'react';
import type { MotionLevel } from '@/types/presentation';

interface MotionRuntimeProps {
  motionLevel: MotionLevel;
  containerRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerId: string;
  disabled?: boolean;
}

// Splits an element's text into per-line spans for reveal animation.
// Wraps each detected line in overflow:hidden + inner translateY span.
function splitIntoLines(el: HTMLElement): HTMLElement[] {
  const text = el.textContent ?? '';
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  el.innerHTML = '';
  el.style.overflow = 'hidden';

  const wordSpans = words.map(w => {
    const span = document.createElement('span');
    span.textContent = w + ' ';
    span.style.display = 'inline-block';
    el.appendChild(span);
    return span;
  });

  // Group words into lines by comparing offsetTop
  const lines: HTMLElement[][] = [];
  let currentLine: HTMLElement[] = [];
  let lastTop = wordSpans[0]?.offsetTop ?? 0;

  for (const span of wordSpans) {
    if (span.offsetTop !== lastTop) {
      if (currentLine.length) lines.push(currentLine);
      currentLine = [];
      lastTop = span.offsetTop;
    }
    currentLine.push(span);
  }
  if (currentLine.length) lines.push(currentLine);

  // Wrap each line group in an overflow:hidden container
  el.innerHTML = '';
  const lineWrappers: HTMLElement[] = [];
  for (const lineWords of lines) {
    const outer = document.createElement('div');
    outer.style.overflow = 'hidden';
    const inner = document.createElement('div');
    inner.style.display = 'block';
    inner.textContent = lineWords.map(s => s.textContent?.trim()).join(' ');
    outer.appendChild(inner);
    el.appendChild(outer);
    lineWrappers.push(inner);
  }
  return lineWrappers;
}

function parseCounterValue(text: string): { prefix: string; number: number; suffix: string } {
  const m = text.trim().match(/^([^0-9\-]*)(-?[\d,]+\.?\d*)(.*)$/);
  if (!m) return { prefix: '', number: 0, suffix: '' };
  return { prefix: m[1], number: parseFloat(m[2].replace(/,/g, '')), suffix: m[3] };
}

export function MotionRuntime({ motionLevel, containerRef, scrollContainerId, disabled }: MotionRuntimeProps): null {
  // Track pointer-event cleanup fns for tilt cards
  const tiltCleanupRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (disabled || motionLevel === 'none') return;

    const container = containerRef.current;
    if (!container) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ctx: any = null;

    const init = async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);

      gsap.registerPlugin(ScrollTrigger);

      // Microsite uses a div scroll container, not window
      ScrollTrigger.config({ autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load,resize' });
      ScrollTrigger.defaults({ scroller: `#${scrollContainerId}` });

      // Clean up previous tilt listeners
      tiltCleanupRef.current.forEach(fn => fn());
      tiltCleanupRef.current = [];

      ctx = gsap.context(() => {
        // ── Fade-up ─────────────────────────────────────────────────────────
        container.querySelectorAll<HTMLElement>('[data-motion="fade-up"]').forEach(el => {
          const delay = parseInt(el.dataset.motionDelay ?? '0', 10) / 1000;
          gsap.from(el, {
            opacity: 0, y: 32, duration: 0.7, ease: 'power2.out', delay,
            scrollTrigger: { trigger: el, start: 'top 87%', toggleActions: 'play none none none' },
          });
        });

        // ── Scale-in ─────────────────────────────────────────────────────────
        container.querySelectorAll<HTMLElement>('[data-motion="scale-in"]').forEach(el => {
          const delay = parseInt(el.dataset.motionDelay ?? '0', 10) / 1000;
          gsap.from(el, {
            scale: 0.88, opacity: 0, duration: 0.7, ease: 'power2.out', delay,
            scrollTrigger: { trigger: el, start: 'top 87%', toggleActions: 'play none none none' },
          });
        });

        // ── Stagger children ─────────────────────────────────────────────────
        container.querySelectorAll<HTMLElement>('[data-motion="stagger"]').forEach(el => {
          const children = Array.from(el.children) as HTMLElement[];
          if (!children.length) return;
          const delay = parseInt(el.dataset.motionDelay ?? '0', 10) / 1000;
          gsap.from(children, {
            opacity: 0, y: 24, stagger: 0.1, duration: 0.6, ease: 'power2.out', delay,
            scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none none' },
          });
        });

        // ── Counter-up ───────────────────────────────────────────────────────
        container.querySelectorAll<HTMLElement>('[data-motion="counter"]').forEach(el => {
          const { prefix, number, suffix } = parseCounterValue(el.textContent ?? '');
          if (number === 0) return;
          const obj = { val: 0 };
          gsap.to(obj, {
            val: number, duration: 1.8, ease: 'power2.out',
            onUpdate() { el.textContent = `${prefix}${Math.round(obj.val).toLocaleString()}${suffix}`; },
            scrollTrigger: { trigger: el, start: 'top 87%', toggleActions: 'play none none none', once: true },
          });
        });

        // ── Text reveal (cinematic / immersive only) ─────────────────────────
        if (motionLevel === 'cinematic' || motionLevel === 'immersive') {
          container.querySelectorAll<HTMLElement>('[data-motion="text-reveal"]').forEach(el => {
            const delay = parseInt(el.dataset.motionDelay ?? '0', 10) / 1000;
            const lines = splitIntoLines(el);
            if (!lines.length) return;
            gsap.from(lines, {
              yPercent: 110, opacity: 0, stagger: 0.08, duration: 0.9, ease: 'power3.out', delay,
              scrollTrigger: { trigger: el, start: 'top 87%', toggleActions: 'play none none none' },
            });
          });
        }

        // ── Parallax (cinematic / immersive only) ────────────────────────────
        if (motionLevel === 'cinematic' || motionLevel === 'immersive') {
          container.querySelectorAll<HTMLElement>('[data-motion="parallax"]').forEach(el => {
            const speed = parseFloat(el.dataset.motionSpeed ?? '0.35');
            gsap.to(el, {
              yPercent: -20 * speed * 10,
              ease: 'none',
              scrollTrigger: {
                trigger: el.closest('section') ?? el,
                scrub: true,
                start: 'top bottom',
                end: 'bottom top',
              },
            });
          });
        }

        // ── 3D Tilt on pointer (cinematic / immersive only) ──────────────────
        if (motionLevel === 'cinematic' || motionLevel === 'immersive') {
          const MAX_TILT = 8;
          container.querySelectorAll<HTMLElement>('[data-motion="tilt"]').forEach(el => {
            el.style.willChange = 'transform';
            el.style.transformStyle = 'preserve-3d';
            el.style.transition = 'transform 0.1s ease-out';

            const onMove = (e: PointerEvent) => {
              const rect = el.getBoundingClientRect();
              const x = (e.clientX - rect.left) / rect.width - 0.5;
              const y = (e.clientY - rect.top) / rect.height - 0.5;
              gsap.to(el, {
                rotateY: x * MAX_TILT * 2,
                rotateX: -y * MAX_TILT * 2,
                transformPerspective: 800,
                ease: 'power1.out',
                duration: 0.4,
              });
            };
            const onLeave = () => {
              gsap.to(el, { rotateY: 0, rotateX: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
            };

            el.addEventListener('pointermove', onMove);
            el.addEventListener('pointerleave', onLeave);
            tiltCleanupRef.current.push(() => {
              el.removeEventListener('pointermove', onMove);
              el.removeEventListener('pointerleave', onLeave);
            });
          });
        }

        // Refresh all triggers after init (handles dynamic height after images load)
        setTimeout(() => ScrollTrigger.refresh(), 400);

      }, container);
    };

    init().catch(err => console.warn('[MotionRuntime] GSAP init failed:', err));

    return () => {
      ctx?.revert();
      tiltCleanupRef.current.forEach(fn => fn());
      tiltCleanupRef.current = [];
      // Import ScrollTrigger lazily to kill all triggers on cleanup
      import('gsap/ScrollTrigger').then(({ ScrollTrigger }) => {
        ScrollTrigger.getAll().forEach(t => t.kill());
      }).catch(() => {});
    };
  }, [motionLevel, disabled, scrollContainerId, containerRef]);

  return null;
}
