'use client';

import type { PluginTokens } from '../../../types/presentation';
import { isCustomDiagram, parseCustomDiagramData } from '../../../lib/customDiagramRenderer';
import { OrbitalDiagram } from '../../diagrams/OrbitalDiagram';
import { PuzzleDiagram } from '../../diagrams/PuzzleDiagram';
import { MermaidChart } from '../../MermaidChart';
import { Reveal } from './Reveal';

interface Props {
  diagram: string;
  tokens: PluginTokens;
  delay?: number;
  caption?: string;
  typeId?: string;
}

export function ThemedMermaid({ diagram, tokens, delay = 0, caption, typeId }: Props) {
  // Dispatch custom SVG diagrams to dedicated renderers
  if (isCustomDiagram(diagram)) {
    const data = parseCustomDiagramData(diagram);
    if (!data) return null;

    return (
      <Reveal delay={delay}>
        <figure
          className={`diagram-container${typeId ? ` type-${typeId}` : ''}`}
          style={{
            margin: '36px 0',
            borderRadius: 12,
            border: `1px solid ${tokens.border}`,
            background: tokens.surfaceCard,
            overflow: 'hidden',
            padding: data.type === 'orbital' ? '24px' : 0,
          }}
        >
          {data.type === 'orbital' && <OrbitalDiagram data={data} tokens={tokens} />}
          {data.type === 'puzzle' && <PuzzleDiagram data={data} tokens={tokens} />}
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
                padding: data.type === 'puzzle' ? '0 0 16px' : undefined,
              }}
            >
              {caption}
            </figcaption>
          )}
        </figure>
      </Reveal>
    );
  }

  return (
    <Reveal delay={delay}>
      <figure
        className={`diagram-container${typeId ? ` type-${typeId}` : ''}`}
        style={{
          margin: '36px 0',
          borderRadius: 12,
          border: `1px solid ${tokens.border}`,
          background: tokens.surfaceCard,
          overflow: 'hidden',
          padding: '28px 32px',
        }}
      >
        <MermaidChart chart={typeof diagram === 'string' ? diagram : ''} tokens={tokens} />
        {caption && (
          <figcaption
            style={{
              marginTop: 12,
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.72rem',
              fontWeight: 400,
              letterSpacing: tokens.labelTracking,
              textTransform: 'uppercase',
              color: tokens.textSubtle,
              textAlign: 'center',
              lineHeight: 1.4,
            }}
          >
            {caption}
          </figcaption>
        )}
      </figure>
    </Reveal>
  );
}
