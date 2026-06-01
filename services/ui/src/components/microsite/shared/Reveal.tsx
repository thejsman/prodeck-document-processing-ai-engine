'use client';

import { useContext } from 'react';
import { motion } from 'motion/react';
import { SectionStreamingContext } from '../TypewriterSection';

type RevealVariant = 'fadeUp' | 'fadeIn' | 'scale' | 'slideLeft' | 'slideRight' | 'staggerWave' | 'blurUp';

interface RevealProps {
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
  className?: string;
  variant?: RevealVariant;
}

type MotionTarget = Record<string, number | string>;

const HIDDEN: Record<RevealVariant, MotionTarget> = {
  fadeUp:      { opacity: 0, y: 24 },
  fadeIn:      { opacity: 0 },
  scale:       { opacity: 0, scale: 0.94 },
  slideLeft:   { opacity: 0, x: -28 },
  slideRight:  { opacity: 0, x: 28 },
  staggerWave: { opacity: 0, y: 20, scale: 0.96 },
  blurUp:      { opacity: 0, y: 18, filter: 'blur(6px)' },
};

const VISIBLE: Record<RevealVariant, MotionTarget> = {
  fadeUp:      { opacity: 1, y: 0 },
  fadeIn:      { opacity: 1 },
  scale:       { opacity: 1, scale: 1 },
  slideLeft:   { opacity: 1, x: 0 },
  slideRight:  { opacity: 1, x: 0 },
  staggerWave: { opacity: 1, y: 0, scale: 1 },
  blurUp:      { opacity: 1, y: 0, filter: 'blur(0px)' },
};

export function Reveal({ children, delay = 0, style, className, variant = 'fadeUp' }: RevealProps) {
  const isStreaming = useContext(SectionStreamingContext);

  // During streaming: no animation — sections appear instantly as auto-scroll reveals them
  if (isStreaming) {
    return (
      <div data-reveal="1" className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      data-reveal="1"
      className={className}
      style={style}
      initial={HIDDEN[variant]}
      whileInView={VISIBLE[variant]}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: delay / 1000 }}
    >
      {children}
    </motion.div>
  );
}
