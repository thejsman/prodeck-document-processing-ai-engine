'use client';

import type { PluginTokens } from '../../../types/presentation';
import { MermaidChart } from '../../MermaidChart';
import { Reveal } from './Reveal';

interface Props {
  diagram: string;
  tokens: PluginTokens;
  delay?: number;
  caption?: string;
}

export function ThemedMermaid({ diagram, tokens, delay = 0, caption }: Props) {
  return (
    <Reveal delay={delay}>
      <figure
        style={{
          margin: 0,
          borderRadius: 8,
          border: `1px solid ${tokens.border}`,
          background: tokens.surfaceCard,
          overflow: 'hidden',
          padding: '24px 20px 16px',
        }}
      >
        <MermaidChart chart={diagram} tokens={tokens} />
        {caption && (
          <figcaption
            style={{
              marginTop: 12,
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.72rem',
              fontWeight: 500,
              letterSpacing: tokens.labelTracking,
              textTransform: 'uppercase',
              color: tokens.textSubtle,
              textAlign: 'center',
            }}
          >
            {caption}
          </figcaption>
        )}
      </figure>
    </Reveal>
  );
}
